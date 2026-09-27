-- 사진 저장소: 비공개 버킷. 브라우저는 직접 읽거나 쓰지 않고,
-- 서버가 소유권을 확인한 뒤 올리고, 짧은 만료 시간의 서명 URL 로만 보여준다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
-- storage.objects 에 브라우저용 정책을 만들지 않는다 = anon/authenticated 접근 불가(서버 service role 만)
