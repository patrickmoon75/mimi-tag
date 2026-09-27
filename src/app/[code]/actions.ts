"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminClient, currentUserId, userClient } from "@/lib/supabase";
import { parse } from "@/lib/tagcode";

const MAX_PHOTOS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

function codeOrThrow(raw: string): string {
  const p = parse(raw);
  if (!p.ok) throw new Error("올바르지 않은 태그");
  return p.code;
}

async function requireUser(code: string): Promise<string> {
  const uid = await currentUserId();
  if (!uid) redirect(`/login?next=/${code}`);
  return uid;
}

/** 소유자 확인(서버에서 다시 확인. 화면에서 넘어온 assetId 를 믿지 않는다) */
async function requireOwner(code: string): Promise<{ uid: string; assetId: string }> {
  const uid = await requireUser(code);
  const { data } = await adminClient().from("assets").select("id, owner_id").eq("tag_code", code).single();
  if (!data || data.owner_id !== uid) throw new Error("내 태그가 아닙니다");
  return { uid, assetId: data.id };
}

async function uploadPhotos(assetId: string, files: File[], kind: "receipt" | "product" | "letter", letterId?: string) {
  const db = adminClient();
  const valid = files.filter((f) => f && f.size > 0).slice(0, MAX_PHOTOS);
  for (const f of valid) {
    const ext = IMAGE_TYPES[f.type];
    if (!ext || f.size > MAX_BYTES) continue;
    const path = `${assetId}/${randomUUID()}.${ext}`;
    const { error } = await db.storage.from("assets").upload(path, f, { contentType: f.type, upsert: false });
    if (error) continue;
    // 봉인 여부는 DB 트리거가 최종 판단한다. 거부되면 올린 파일을 지운다.
    const { error: insErr } = await db.from("media").insert({ asset_id: assetId, kind, path, letter_id: letterId ?? null });
    if (insErr) await db.storage.from("assets").remove([path]);
  }
}

const text = (fd: FormData, key: string, max = 200): string | null => {
  const v = String(fd.get(key) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

// ── 첫 스캔 등록 ───────────────────────────────────────────
export async function registerAsset(rawCode: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  await requireUser(code);
  const useProof = fd.get("use_proof") === "on";
  const useLetter = fd.get("use_letter") === "on";
  const useLost = fd.get("use_lost") === "on";
  const name = text(fd, "name", 60);
  if (!name || !(useProof || useLetter || useLost)) redirect(`/${code}?error=register`);

  const supabase = await userClient();
  const { error } = await supabase.rpc("register_asset", {
    p_code: code, p_name: name, p_category: text(fd, "category", 30),
    p_use_proof: useProof, p_use_letter: useLetter, p_use_lost_contact: useLost,
  });
  if (error) redirect(`/${code}?error=taken`);
  redirect(`/${code}?step=${useProof ? "proof" : useLetter ? "letter" : "done"}`);
}

// ── 구매증명 ──────────────────────────────────────────────
export async function saveProof(rawCode: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  const { assetId } = await requireOwner(code);
  const price = Number(String(fd.get("price") ?? "").replace(/[^\d]/g, ""));
  const supabase = await userClient();
  const { error } = await supabase.rpc("upsert_proof", {
    p_asset: assetId,
    p_store: text(fd, "store", 60),
    p_purchased_on: text(fd, "purchased_on", 10),
    p_price_krw: Number.isFinite(price) && price > 0 ? price : null,
    p_warranty: text(fd, "warranty", 30),
    p_serial_no: text(fd, "serial_no", 60),
    p_hide_price: fd.get("hide_price") === "on",
  });
  if (error) redirect(`/${code}?step=proof&error=${error.message.startsWith("SEALED") ? "sealed" : "save"}`);
  await uploadPhotos(assetId, fd.getAll("receipt") as File[], "receipt");
  await uploadPhotos(assetId, fd.getAll("product") as File[], "product");
  const { data } = await adminClient().from("assets").select("use_letter").eq("id", assetId).single();
  redirect(`/${code}?step=${data?.use_letter ? "letter" : "done"}`);
}

// ── 편지 ─────────────────────────────────────────────────
export async function saveLetter(rawCode: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  const { assetId } = await requireOwner(code);
  const body = text(fd, "body", 4000);
  if (!body) redirect(`/${code}?step=letter&error=empty`);
  const links = [1, 2, 3, 4, 5]
    .map((i) => ({ label: text(fd, `link_label_${i}`, 40), url: text(fd, `link_url_${i}`, 300) }))
    .filter((l) => l.url && /^https?:\/\//.test(l.url))
    .map((l) => ({ label: l.label ?? l.url, url: l.url }));
  const supabase = await userClient();
  const { data: letterId, error } = await supabase.rpc("add_letter", {
    p_asset: assetId,
    p_recipient: text(fd, "recipient", 30),
    p_sender: text(fd, "sender", 30),
    p_body: body,
    p_stationery: text(fd, "stationery", 20) ?? "forest",
    p_bgm: text(fd, "bgm", 40),
    p_font: text(fd, "font", 20),
    p_links: links,
  });
  if (error || !letterId) redirect(`/${code}?step=letter&error=save`);
  await uploadPhotos(assetId, fd.getAll("photos") as File[], "letter", letterId as string);
  redirect(`/${code}?step=done`);
}

// ── 설정: 분실 신고, 편지 공개, 분실 연락 ─────────────────────
export async function setLost(rawCode: string, lost: boolean) {
  const code = codeOrThrow(rawCode);
  const { assetId } = await requireOwner(code);
  const supabase = await userClient();
  await supabase.rpc("set_lost", { p_asset: assetId, p_lost: lost });
  revalidatePath(`/${code}`);
}

export async function setVisibility(rawCode: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  const { assetId } = await requireOwner(code);
  const supabase = await userClient();
  await supabase.from("assets").update({
    letter_public: fd.get("letter_public") === "on",
    use_lost_contact: fd.get("use_lost") === "on",
  }).eq("id", assetId);
  revalidatePath(`/${code}`);
}

// ── 소유권 넘기기 ─────────────────────────────────────────
export async function createTransfer(rawCode: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  const { assetId } = await requireOwner(code);
  const mode = fd.get("mode") === "sale" ? "sale" : "gift";
  const supabase = await userClient();
  await supabase.rpc("create_transfer", { p_asset: assetId, p_mode: mode, p_hide_price: fd.get("hide_price") === "on" });
  revalidatePath(`/${code}`);
}

export async function cancelTransfer(rawCode: string) {
  const code = codeOrThrow(rawCode);
  const { assetId, uid } = await requireOwner(code);
  await adminClient().from("transfers").update({ cancelled_at: new Date().toISOString() })
    .eq("asset_id", assetId).eq("from_owner", uid).is("accepted_at", null).is("cancelled_at", null);
  revalidatePath(`/${code}`);
}

/** 선물은 태그를 손에 쥔 사람이 받는다: 스캔 화면에서 바로 수락 */
export async function acceptGiftByTag(rawCode: string) {
  const code = codeOrThrow(rawCode);
  await requireUser(code);
  const db = adminClient();
  const { data: asset } = await db.from("assets").select("id").eq("tag_code", code).single();
  const { data: t } = await db.from("transfers").select("token").eq("asset_id", asset?.id ?? "").eq("mode", "gift")
    .is("accepted_at", null).is("cancelled_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!t) redirect(`/${code}?error=transfer`);
  const supabase = await userClient();
  const { error } = await supabase.rpc("accept_transfer", { p_token: t.token });
  redirect(error ? `/${code}?error=transfer` : `/${code}?step=received`);
}

// ── 습득자 연락 ───────────────────────────────────────────
export async function sendFinderMessage(rawCode: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  const quick = text(fd, "quick", 60);
  const body = [quick, text(fd, "body", 900)].filter(Boolean).join("\n");
  if (!body) redirect(`/${code}?error=empty`);
  const db = adminClient();
  const { data: asset } = await db.from("assets").select("id, status, use_lost_contact").eq("tag_code", code).single();
  if (!asset || !(asset.status === "lost" || asset.use_lost_contact)) redirect(`/${code}`);

  const lat = Number(fd.get("lat")), lng = Number(fd.get("lng"));
  const { data: thread } = await db.from("finder_threads").insert({
    asset_id: asset.id,
    lat: Number.isFinite(lat) && fd.get("lat") ? lat : null,
    lng: Number.isFinite(lng) && fd.get("lng") ? lng : null,
  }).select("id, finder_token").single();
  if (!thread) redirect(`/${code}?error=send`);
  await db.from("finder_messages").insert({ thread_id: thread.id, side: "finder", body });
  redirect(`/f/${thread.finder_token}`);
}

export async function finderReply(token: string, fd: FormData) {
  const body = text(fd, "body", 1000);
  const db = adminClient();
  const { data: thread } = await db.from("finder_threads").select("id, closed_at").eq("finder_token", token).single();
  if (thread && body && !thread.closed_at) await db.from("finder_messages").insert({ thread_id: thread.id, side: "finder", body });
  revalidatePath(`/f/${token}`);
}

export async function ownerReply(rawCode: string, threadId: string, fd: FormData) {
  const code = codeOrThrow(rawCode);
  const { assetId } = await requireOwner(code);
  const body = text(fd, "body", 1000);
  const db = adminClient();
  const { data: thread } = await db.from("finder_threads").select("id").eq("id", threadId).eq("asset_id", assetId).single();
  if (!thread) throw new Error("대화를 찾을 수 없습니다");
  await db.from("finder_messages").update({ read_at: new Date().toISOString() })
    .eq("thread_id", threadId).eq("side", "finder").is("read_at", null);
  if (body) await db.from("finder_messages").insert({ thread_id: threadId, side: "owner", body });
  revalidatePath(`/${code}`);
}
