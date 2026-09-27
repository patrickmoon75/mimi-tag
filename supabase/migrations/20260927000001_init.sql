-- 미미태그 초기 스키마
-- 대상: Supabase (Postgres 15+). auth.users, auth.uid() 는 Supabase 가 제공한다.
-- 원칙: 공개 조회는 서버(service role)가 골라낸 필드로만 한다. 브라우저 역할(anon/authenticated)은
--       자기 소유 행만 읽고 쓴다. 봉인·소유 이력 불변은 트리거가 강제한다.

-- ---------------------------------------------------------------------------
-- 설정값
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key   text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  ('seal_days', '30'),          -- 수정 가능 기간(일). 확정 전 가정값
  ('transfer_expire_days', '7');

create or replace function public.setting_int(p_key text)
returns int language sql stable as $$
  select value::int from public.app_settings where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- 열거형
-- ---------------------------------------------------------------------------
create type public.issue_type    as enum ('S', 'P', 'M');           -- 스티커 / 제품 부착 / 판촉·단체
create type public.tag_status    as enum ('issued', 'active', 'void');
create type public.asset_status  as enum ('normal', 'lost');
create type public.media_kind    as enum ('receipt', 'product', 'letter');
create type public.owner_event   as enum ('register', 'gift', 'sale');
create type public.transfer_mode as enum ('gift', 'sale');
create type public.thread_side   as enum ('finder', 'owner');

-- ---------------------------------------------------------------------------
-- 사용자
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 발급 묶음과 태그 (관리자 전용)
-- ---------------------------------------------------------------------------
create table public.batches (
  id           bigint generated always as identity primary key,
  issue_type   public.issue_type not null,
  country      char(2) not null default 'KR',
  target       text,                 -- 대상(예: 자체, 다이소, 매장명)
  product_name text not null,
  partner      text,                 -- 납품처
  banner_image text,                 -- 저장소 경로
  banner_link  text,
  quantity     int not null check (quantity between 1 and 100000),
  created_at   timestamptz not null default now()
);

create table public.tags (
  code         varchar(10) primary key check (code ~ '^[SPM][0-9A-HJKMNP-TV-Z]{9}$'),
  batch_id     bigint not null references public.batches (id),
  status       public.tag_status not null default 'issued',
  legacy_sno   varchar(16) unique,   -- 레떼즈 기존 코드 이관용
  created_at   timestamptz not null default now(),
  activated_at timestamptz
);
create index tags_batch_idx on public.tags (batch_id);

-- ---------------------------------------------------------------------------
-- 자산 (태그 1개 = 자산 1개)
-- ---------------------------------------------------------------------------
create table public.assets (
  id              uuid primary key default gen_random_uuid(),
  tag_code        varchar(10) not null unique references public.tags (code),  -- 소유권 잠금: 태그당 하나
  owner_id        uuid not null references auth.users (id),
  name            text not null check (char_length(name) between 1 and 60),
  category        text,
  use_proof       boolean not null default false,
  use_letter      boolean not null default false,
  use_lost_contact boolean not null default false,
  letter_public   boolean not null default true,   -- 태그를 스캔한 사람에게 편지 공개
  status          public.asset_status not null default 'normal',
  lost_at         timestamptz,
  created_at      timestamptz not null default now(),
  seal_at         timestamptz not null,
  check (use_proof or use_letter or use_lost_contact)
);
create index assets_owner_idx on public.assets (owner_id);

create table public.proofs (
  asset_id      uuid primary key references public.assets (id) on delete restrict,
  store         text,
  purchased_on  date,
  price_krw     int check (price_krw >= 0),
  warranty      text,
  serial_no     text,
  hide_price    boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table public.media (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets (id) on delete restrict,
  letter_id   uuid,                  -- 편지 사진이면 편지 id
  kind        public.media_kind not null,
  path        text not null,         -- 저장소(버킷 assets) 안의 경로
  created_at  timestamptz not null default now()
);
create index media_asset_idx on public.media (asset_id);

create table public.letters (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references public.assets (id) on delete restrict,
  author_id      uuid not null references auth.users (id),
  recipient_name text,
  sender_name    text,
  body           text not null check (char_length(body) between 1 and 4000),
  stationery     text,
  bgm            text,
  font           text,
  links          jsonb not null default '[]'::jsonb,
  opened_count   int not null default 0,
  created_at     timestamptz not null default now(),
  seal_at        timestamptz not null,
  check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5)
);
create index letters_asset_idx on public.letters (asset_id);

alter table public.media
  add constraint media_letter_fk foreign key (letter_id) references public.letters (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 소유 이력(추가만 가능)과 이전 요청
-- ---------------------------------------------------------------------------
create table public.ownership_events (
  id          bigint generated always as identity primary key,
  asset_id    uuid not null references public.assets (id),
  from_owner  uuid references auth.users (id),
  to_owner    uuid not null references auth.users (id),
  kind        public.owner_event not null,
  created_at  timestamptz not null default now()
);
create index ownership_asset_idx on public.ownership_events (asset_id);

create table public.transfers (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets (id),
  from_owner  uuid not null references auth.users (id),
  token       text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  mode        public.transfer_mode not null,
  hide_price  boolean not null default true,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,
  cancelled_at timestamptz
);
-- 자산당 진행 중인 요청은 하나
create unique index transfers_open_idx on public.transfers (asset_id)
  where accepted_at is null and cancelled_at is null;

-- ---------------------------------------------------------------------------
-- 습득자 연락 (습득자는 로그인 없이 비밀 토큰 링크로만 대화 확인)
-- ---------------------------------------------------------------------------
create table public.finder_threads (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets (id),
  finder_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index finder_threads_asset_idx on public.finder_threads (asset_id);

create table public.finder_messages (
  id          bigint generated always as identity primary key,
  thread_id   uuid not null references public.finder_threads (id) on delete cascade,
  side        public.thread_side not null,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index finder_messages_thread_idx on public.finder_messages (thread_id);

-- 스캔·요청 빈도 기록(어뷰징 방지용, 서버만 기록)
create table public.scan_log (
  id         bigint generated always as identity primary key,
  tag_code   varchar(10),
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index scan_log_ip_idx on public.scan_log (ip_hash, created_at);

-- AI 초안 사용 횟수
create table public.ai_usage (
  user_id    uuid not null references auth.users (id),
  asset_id   uuid not null references public.assets (id),
  count      int not null default 0,
  primary key (user_id, asset_id)
);

-- ===========================================================================
-- 봉인 트리거
-- ===========================================================================
create or replace function public.guard_sealed_child()
returns trigger language plpgsql as $$
declare
  v_seal timestamptz;
  v_asset uuid := coalesce(old.asset_id, new.asset_id);
begin
  select seal_at into v_seal from public.assets where id = v_asset;
  if v_seal is not null and now() >= v_seal then
    raise exception 'SEALED: 봉인된 기록은 수정하거나 삭제할 수 없습니다'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger proofs_sealed before update or delete on public.proofs
  for each row execute function public.guard_sealed_child();
create trigger media_sealed before update or delete on public.media
  for each row execute function public.guard_sealed_child();

-- 봉인 이후에는 새 사진 추가도 막는다(편지 사진은 편지 봉인 기준)
create or replace function public.guard_media_insert()
returns trigger language plpgsql as $$
declare v_seal timestamptz;
begin
  if new.letter_id is not null then
    select seal_at into v_seal from public.letters where id = new.letter_id;
  else
    select seal_at into v_seal from public.assets where id = new.asset_id;
  end if;
  if now() >= v_seal then
    raise exception 'SEALED: 봉인 이후에는 사진을 추가할 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger media_insert_sealed before insert on public.media
  for each row execute function public.guard_media_insert();

-- 구매증명은 봉인 이후 새로 만들 수도 없다
create or replace function public.guard_proof_insert()
returns trigger language plpgsql as $$
declare v_seal timestamptz;
begin
  select seal_at into v_seal from public.assets where id = new.asset_id;
  if now() >= v_seal then
    raise exception 'SEALED: 봉인 이후에는 구매증명을 추가할 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger proofs_insert_sealed before insert on public.proofs
  for each row execute function public.guard_proof_insert();

-- 편지: 봉인 이후 열람 수 증가만 허용, 삭제 불가
create or replace function public.guard_sealed_letter()
returns trigger language plpgsql as $$
begin
  if now() >= old.seal_at then
    if tg_op = 'DELETE' then
      raise exception 'SEALED: 봉인된 편지는 삭제할 수 없습니다' using errcode = 'P0001';
    end if;
    if (to_jsonb(new) - 'opened_count') is distinct from (to_jsonb(old) - 'opened_count')
       or new.opened_count < old.opened_count then
      raise exception 'SEALED: 봉인된 편지는 수정할 수 없습니다' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.seal_at <> old.seal_at or new.asset_id <> old.asset_id) then
    raise exception '편지의 봉인 시각과 자산은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger letters_sealed before update or delete on public.letters
  for each row execute function public.guard_sealed_letter();

-- 자산: seal_at 은 되돌리거나 늦출 수 없고, 봉인 후 이름·용도·카테고리 변경 불가
create or replace function public.guard_asset()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception '자산은 삭제할 수 없습니다(태그 폐기로 처리)' using errcode = 'P0001';
  end if;
  if new.seal_at > old.seal_at or new.tag_code <> old.tag_code or new.created_at <> old.created_at then
    raise exception '봉인 시각·태그·등록 시각은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  if now() >= old.seal_at and (
       new.name is distinct from old.name or
       new.category is distinct from old.category or
       new.use_proof <> old.use_proof or
       new.use_letter <> old.use_letter) then
    raise exception 'SEALED: 봉인된 자산 정보는 수정할 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger assets_guard before update or delete on public.assets
  for each row execute function public.guard_asset();

-- 소유 이력은 추가만 가능
create or replace function public.forbid_change()
returns trigger language plpgsql as $$
begin
  raise exception '이 기록은 수정하거나 삭제할 수 없습니다' using errcode = 'P0001';
end $$;
create trigger ownership_events_immutable before update or delete on public.ownership_events
  for each row execute function public.forbid_change();

-- ===========================================================================
-- 업무 함수 (한 트랜잭션으로 처리해야 하는 것들)
-- ===========================================================================

-- 첫 스캔 등록: 태그 잠금 → 자산 생성 → 태그 활성화 → 이력 기록
create or replace function public.register_asset(
  p_code text, p_name text, p_category text,
  p_use_proof boolean, p_use_letter boolean, p_use_lost_contact boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status public.tag_status;
  v_asset uuid;
begin
  if v_uid is null then raise exception '로그인이 필요합니다' using errcode = '28000'; end if;
  select status into v_status from public.tags where code = upper(p_code) for update;
  if not found then raise exception '존재하지 않는 태그입니다' using errcode = 'P0002'; end if;
  if v_status <> 'issued' then raise exception '이미 등록되었거나 사용할 수 없는 태그입니다' using errcode = 'P0001'; end if;

  insert into public.assets (tag_code, owner_id, name, category, use_proof, use_letter, use_lost_contact, seal_at)
  values (upper(p_code), v_uid, p_name, p_category, p_use_proof, p_use_letter, p_use_lost_contact,
          now() + make_interval(days => public.setting_int('seal_days')))
  returning id into v_asset;

  update public.tags set status = 'active', activated_at = now() where code = upper(p_code);
  insert into public.ownership_events (asset_id, from_owner, to_owner, kind) values (v_asset, null, v_uid, 'register');
  return v_asset;
end $$;

-- 편지 작성: 편지마다 자기 봉인 시각을 가진다
create or replace function public.add_letter(
  p_asset uuid, p_recipient text, p_sender text, p_body text,
  p_stationery text, p_bgm text, p_font text, p_links jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.assets where id = p_asset and owner_id = auth.uid()) then
    raise exception '내 태그가 아닙니다' using errcode = '42501';
  end if;
  insert into public.letters (asset_id, author_id, recipient_name, sender_name, body, stationery, bgm, font, links, seal_at)
  values (p_asset, auth.uid(), p_recipient, p_sender, p_body, p_stationery, p_bgm, p_font, coalesce(p_links, '[]'::jsonb),
          now() + make_interval(days => public.setting_int('seal_days')))
  returning id into v_id;
  update public.assets set use_letter = true where id = p_asset and not use_letter and now() < seal_at;
  return v_id;
end $$;

-- 넘기기 요청 생성
create or replace function public.create_transfer(p_asset uuid, p_mode public.transfer_mode, p_hide_price boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not exists (select 1 from public.assets where id = p_asset and owner_id = auth.uid()) then
    raise exception '내 태그가 아닙니다' using errcode = '42501';
  end if;
  update public.transfers set cancelled_at = now()
   where asset_id = p_asset and accepted_at is null and cancelled_at is null;
  insert into public.transfers (asset_id, from_owner, mode, hide_price, expires_at)
  values (p_asset, auth.uid(), p_mode, coalesce(p_hide_price, true),
          now() + make_interval(days => public.setting_int('transfer_expire_days')))
  returning token into v_token;
  return v_token;
end $$;

-- 넘기기 수락: 소유자 변경 + 이력 추가 + 요청 종료를 한 번에
create or replace function public.accept_transfer(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t public.transfers%rowtype;
begin
  if v_uid is null then raise exception '로그인이 필요합니다' using errcode = '28000'; end if;
  select * into t from public.transfers where token = p_token for update;
  if not found or t.accepted_at is not null or t.cancelled_at is not null or now() > t.expires_at then
    raise exception '유효하지 않거나 만료된 요청입니다' using errcode = 'P0001';
  end if;
  if t.from_owner = v_uid then
    raise exception '본인에게는 넘길 수 없습니다' using errcode = 'P0001';
  end if;
  -- 요청 이후 소유자가 바뀌었으면 무효
  if not exists (select 1 from public.assets where id = t.asset_id and owner_id = t.from_owner for update) then
    raise exception '요청이 더 이상 유효하지 않습니다' using errcode = 'P0001';
  end if;

  update public.assets set owner_id = v_uid, status = 'normal', lost_at = null where id = t.asset_id;
  insert into public.ownership_events (asset_id, from_owner, to_owner, kind)
  values (t.asset_id, t.from_owner, v_uid, case t.mode when 'gift' then 'gift'::public.owner_event else 'sale'::public.owner_event end);
  update public.transfers set accepted_by = v_uid, accepted_at = now() where id = t.id;
  return t.asset_id;
end $$;

-- 구매증명 저장(봉인 전까지만, 트리거가 강제)
create or replace function public.upsert_proof(
  p_asset uuid, p_store text, p_purchased_on date, p_price_krw int,
  p_warranty text, p_serial_no text, p_hide_price boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.assets where id = p_asset and owner_id = auth.uid()) then
    raise exception '내 태그가 아닙니다' using errcode = '42501';
  end if;
  insert into public.proofs (asset_id, store, purchased_on, price_krw, warranty, serial_no, hide_price)
  values (p_asset, p_store, p_purchased_on, p_price_krw, p_warranty, p_serial_no, coalesce(p_hide_price, true))
  on conflict (asset_id) do update
     set store = excluded.store, purchased_on = excluded.purchased_on, price_krw = excluded.price_krw,
         warranty = excluded.warranty, serial_no = excluded.serial_no, hide_price = excluded.hide_price,
         updated_at = now();
  update public.assets set use_proof = true where id = p_asset and not use_proof and now() < seal_at;
end $$;

-- 최초 등록자(구매자) 여부: 금액·영수증은 최초 등록자에게만, 또는 숨김 해제 시에만 보인다
create or replace function public.is_first_owner(p_asset uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ownership_events
                  where asset_id = p_asset and kind = 'register' and to_owner = p_user)
$$;

-- 분실 신고 켜기/끄기
create or replace function public.set_lost(p_asset uuid, p_lost boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.assets
     set status = case when p_lost then 'lost'::public.asset_status else 'normal'::public.asset_status end,
         lost_at = case when p_lost then now() else null end
   where id = p_asset and owner_id = auth.uid();
  if not found then raise exception '내 태그가 아닙니다' using errcode = '42501'; end if;
end $$;

-- ===========================================================================
-- 행 수준 보안(RLS): 브라우저는 자기 것만. 공개 화면은 서버(service role)가 처리.
-- ===========================================================================
alter table public.app_settings     enable row level security;
alter table public.profiles         enable row level security;
alter table public.batches          enable row level security;
alter table public.tags             enable row level security;
alter table public.assets           enable row level security;
alter table public.proofs           enable row level security;
alter table public.media            enable row level security;
alter table public.letters          enable row level security;
alter table public.ownership_events enable row level security;
alter table public.transfers        enable row level security;
alter table public.finder_threads   enable row level security;
alter table public.finder_messages  enable row level security;
alter table public.scan_log         enable row level security;
alter table public.ai_usage         enable row level security;
-- app_settings, batches, tags, scan_log, ai_usage: 정책 없음 = 브라우저 접근 불가(서버 전용)

create policy "본인 프로필" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid() and is_admin = false);

create policy "내 자산 조회" on public.assets for select using (owner_id = auth.uid());
create policy "내 자산 수정" on public.assets for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- proofs, media: 브라우저 정책 없음. 금액·영수증을 새 소유자에게 숨겨야 하므로
-- 조회는 서버가 is_first_owner / hide_price 규칙으로 걸러서 내려주고, 쓰기는 함수로만 한다.

create policy "내 편지 조회" on public.letters for select
  using (exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = auth.uid()));
create policy "내 편지 수정" on public.letters for update
  using (author_id = auth.uid() and exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = auth.uid()));

create policy "내 소유 이력" on public.ownership_events for select
  using (exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = auth.uid()));

create policy "내 이전 요청" on public.transfers for select using (from_owner = auth.uid());

create policy "내 태그의 습득 연락" on public.finder_threads for select
  using (exists (select 1 from public.assets a where a.id = asset_id and a.owner_id = auth.uid()));
create policy "내 태그의 습득 메시지" on public.finder_messages for select
  using (exists (select 1 from public.finder_threads t join public.assets a on a.id = t.asset_id
                 where t.id = thread_id and a.owner_id = auth.uid()));

-- 업무 함수만 브라우저에 열어준다
revoke all on function public.register_asset(text, text, text, boolean, boolean, boolean) from public;
revoke all on function public.add_letter(uuid, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.create_transfer(uuid, public.transfer_mode, boolean) from public;
revoke all on function public.accept_transfer(text) from public;
revoke all on function public.set_lost(uuid, boolean) from public;
revoke all on function public.upsert_proof(uuid, text, date, int, text, text, boolean) from public;
revoke all on function public.is_first_owner(uuid, uuid) from public;
grant execute on function public.upsert_proof(uuid, text, date, int, text, text, boolean) to authenticated;
grant execute on function public.register_asset(text, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.add_letter(uuid, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.create_transfer(uuid, public.transfer_mode, boolean) to authenticated;
grant execute on function public.accept_transfer(text) to authenticated;
grant execute on function public.set_lost(uuid, boolean) to authenticated;

-- 새 가입자 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 편지 열람 수 증가(서버 전용). 봉인 후에도 열람 수만은 올라갈 수 있다.
create or replace function public.increment_letter_open(p_letter uuid)
returns void language sql security definer set search_path = public as $$
  update public.letters set opened_count = opened_count + 1 where id = p_letter
$$;
revoke all on function public.increment_letter_open(uuid) from public;
grant execute on function public.increment_letter_open(uuid) to service_role;
