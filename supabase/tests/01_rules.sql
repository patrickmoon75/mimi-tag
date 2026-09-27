-- 스키마 규칙 검증. 실패하면 예외로 멈춘다.
\set ON_ERROR_STOP on

grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

-- 준비: 사용자 A(구매자), B(받는 사람), C(제3자), 태그 발급
insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '{"name":"A"}'),
  ('00000000-0000-0000-0000-00000000000b', '{"name":"B"}'),
  ('00000000-0000-0000-0000-00000000000c', '{"name":"C"}');
insert into public.batches (issue_type, product_name, quantity) values ('S', '테스트', 3);
insert into public.tags (code, batch_id) values ('S7K3M9QX2P', 1);

do $$
declare
  v_asset uuid; v_letter uuid; v_token text; ok boolean;
begin
  -- 프로필 자동 생성
  assert (select count(*) from public.profiles) = 3, '프로필 자동 생성';

  -- A 등록
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  v_asset := public.register_asset('s7k3m9qx2p', '무선 청소기', '가전', true, true, false);
  assert (select status from public.tags where code = 'S7K3M9QX2P') = 'active', '태그 활성화';
  assert (select count(*) from public.ownership_events where asset_id = v_asset) = 1, '등록 이력';

  -- 중복 등록 차단(소유권 잠금)
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  ok := false;
  begin perform public.register_asset('S7K3M9QX2P', 'x', null, true, false, false);
  exception when others then ok := true; end;
  assert ok, '중복 등록 차단';

  -- 증명·편지 작성(봉인 전)
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.upsert_proof(v_asset, '하이마트', '2026-09-27', 399000, '1년', 'SN1', true);
  perform public.upsert_proof(v_asset, '하이마트 동탄', '2026-09-27', 399000, '1년', 'SN1', true);
  assert (select store from public.proofs where asset_id = v_asset) = '하이마트 동탄', '봉인 전 수정 가능';
  v_letter := public.add_letter(v_asset, '준', '아빠', '생일 축하해', 'forest', null, 'hand', '[]');

  -- 남의 태그에 증명 쓰기 차단
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  ok := false;
  begin perform public.upsert_proof(v_asset, 'x', null, null, null, null, true);
  exception when others then ok := true; end;
  assert ok, '남의 태그 증명 차단';

  -- 봉인: 시각을 과거로 당긴다(당기는 것은 허용, 늦추는 것은 금지)
  update public.assets set seal_at = now() - interval '1 second' where id = v_asset;
  ok := false;
  begin update public.assets set seal_at = now() + interval '10 days' where id = v_asset;
  exception when others then ok := true; end;
  assert ok, '봉인 시각 늦추기 금지';

  ok := false;
  begin update public.proofs set price_krw = 1 where asset_id = v_asset;
  exception when others then ok := sqlerrm like 'SEALED%'; end;
  assert ok, '봉인 후 증명 수정 거부';

  ok := false;
  begin delete from public.proofs where asset_id = v_asset;
  exception when others then ok := sqlerrm like 'SEALED%'; end;
  assert ok, '봉인 후 증명 삭제 거부';

  ok := false;
  begin insert into public.media (asset_id, kind, path) values (v_asset, 'receipt', 'x.jpg');
  exception when others then ok := sqlerrm like 'SEALED%'; end;
  assert ok, '봉인 후 사진 추가 거부';

  ok := false;
  begin update public.assets set name = '바꿈' where id = v_asset;
  exception when others then ok := sqlerrm like 'SEALED%'; end;
  assert ok, '봉인 후 자산 이름 수정 거부';

  -- 편지 봉인: 열람 수는 올라가고 본문은 못 바꾼다
  update public.letters set seal_at = seal_at where id = v_letter; -- no-op 허용
  -- 편지 seal_at 변경은 금지이므로 봉인 상태를 만들려면 새 편지를 과거 봉인으로 넣는다
  insert into public.letters (asset_id, author_id, body, seal_at)
  values (v_asset, '00000000-0000-0000-0000-00000000000a', '봉인된 편지', now() - interval '1 second')
  returning id into v_letter;
  update public.letters set opened_count = opened_count + 1 where id = v_letter;
  assert (select opened_count from public.letters where id = v_letter) = 1, '봉인 후 열람 수 증가 허용';
  ok := false;
  begin update public.letters set body = '고침' where id = v_letter;
  exception when others then ok := sqlerrm like 'SEALED%'; end;
  assert ok, '봉인 후 편지 수정 거부';
  ok := false;
  begin delete from public.letters where id = v_letter;
  exception when others then ok := sqlerrm like 'SEALED%'; end;
  assert ok, '봉인 후 편지 삭제 거부';

  -- 분실 신고는 봉인 후에도 가능
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.set_lost(v_asset, true);
  assert (select status from public.assets where id = v_asset) = 'lost', '봉인 후 분실 신고';

  -- 소유권 이전: A → B
  v_token := public.create_transfer(v_asset, 'gift', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  ok := false;
  begin perform public.accept_transfer(v_token);
  exception when others then ok := true; end;
  assert ok, '본인 수락 거부';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  perform public.accept_transfer(v_token);
  assert (select owner_id from public.assets where id = v_asset) = '00000000-0000-0000-0000-00000000000b', '소유자 변경';
  assert (select status from public.assets where id = v_asset) = 'normal', '이전 시 분실 해제';
  assert (select count(*) from public.ownership_events where asset_id = v_asset) = 2, '이전 이력';
  assert (select store from public.proofs where asset_id = v_asset) = '하이마트 동탄', '증명 승계';
  assert public.is_first_owner(v_asset, '00000000-0000-0000-0000-00000000000a'), 'A는 최초 등록자';
  assert not public.is_first_owner(v_asset, '00000000-0000-0000-0000-00000000000b'), 'B는 최초 등록자 아님';

  -- 같은 토큰 재사용 차단
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  ok := false;
  begin perform public.accept_transfer(v_token);
  exception when others then ok := true; end;
  assert ok, '토큰 재사용 차단';

  -- 소유 이력 불변
  ok := false;
  begin delete from public.ownership_events where asset_id = v_asset;
  exception when others then ok := true; end;
  assert ok, '소유 이력 삭제 금지';

  -- 자산 삭제 금지
  ok := false;
  begin delete from public.assets where id = v_asset;
  exception when others then ok := true; end;
  assert ok, '자산 삭제 금지';

  raise notice '모든 DB 규칙 검증 통과';
end $$;

-- RLS: 브라우저 역할로 남의 자산이 안 보이는지
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from public.assets) = 0, 'C에게 남의 자산 안 보임';
  assert (select count(*) from public.tags) = 0, '태그 테이블 브라우저 차단';
  assert (select count(*) from public.proofs) = 0, '증명 테이블 브라우저 차단';
  raise notice 'RLS 검증 통과';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert (select count(*) from public.assets) = 1, 'B에게 자기 자산 보임';
  assert (select count(*) from public.proofs) = 0, 'B도 증명 테이블 직접 조회 불가(서버 경유)';
end $$;
reset role;
