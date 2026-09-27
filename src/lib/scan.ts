import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { adminClient, currentUserId } from "./supabase";
import { parse } from "./tagcode";

/**
 * 스캔 한 번에 무엇을 보여줄지 결정한다.
 * 이 파일이 "공개 화면에 나가는 필드"의 유일한 출입구다. 여기서 고른 필드만 화면에 전달된다.
 */

export type LetterView = {
  id: string;
  recipientName: string | null;
  senderName: string | null;
  body: string;
  stationery: string | null;
  bgm: string | null;
  font: string | null;
  links: { label: string; url: string }[];
  photos: string[];
  createdAt: string;
  sealed: boolean;
};

export type ProofView = {
  store: string | null;
  purchasedOn: string | null;
  priceKrw: number | null; // 숨김이면 null
  priceHidden: boolean;
  warranty: string | null;
  serialNo: string | null;
  receiptPhotos: string[]; // 숨김이면 빈 배열
};

export type OwnerView = {
  kind: "owner";
  code: string;
  assetId: string;
  name: string;
  category: string | null;
  useProof: boolean;
  useLetter: boolean;
  useLostContact: boolean;
  letterPublic: boolean;
  status: "normal" | "lost";
  createdAt: string;
  sealAt: string;
  sealed: boolean;
  isFirstOwner: boolean;
  proof: ProofView | null;
  productPhotos: string[];
  letters: (LetterView & { openedCount: number })[];
  events: { kind: string; at: string }[];
  openTransfer: { token: string; mode: "gift" | "sale"; expiresAt: string } | null;
  threads: { id: string; createdAt: string; lastBody: string; lastSide: string; unread: number }[];
};

export type ScanView =
  | { kind: "invalid" }
  | { kind: "unavailable" }
  | { kind: "rate_limited" }
  | { kind: "unregistered"; code: string; loggedIn: boolean }
  | OwnerView
  | {
      kind: "gift";
      code: string;
      name: string;
      letter: LetterView | null;
      proof: { store: string | null; purchasedOn: string | null; warranty: string | null } | null;
      loggedIn: boolean;
    }
  | { kind: "lost"; code: string; name: string; category: string | null; lostAt: string | null; photo: string | null }
  | {
      kind: "public";
      code: string;
      name: string;
      letter: LetterView | null;
      lostContact: boolean;
      banner: { image: string | null; link: string | null } | null;
    };

const SCAN_LIMIT_PER_MINUTE = 30;
const PHOTO_TTL_SECONDS = 60 * 10;

async function ipHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  return createHash("sha256").update(`${process.env.SCAN_HASH_SALT ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

/** 같은 IP 에서 1분에 너무 많이 스캔하면 막는다(코드 추측 공격 방지) */
async function allowScan(code: string | null): Promise<boolean> {
  const db = adminClient();
  const hash = await ipHash();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db
    .from("scan_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", hash)
    .gte("created_at", since);
  await db.from("scan_log").insert({ tag_code: code, ip_hash: hash });
  return (count ?? 0) < SCAN_LIMIT_PER_MINUTE;
}

async function signed(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data } = await adminClient().storage.from("assets").createSignedUrls(paths, PHOTO_TTL_SECONDS);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => Boolean(u));
}

type LetterRow = {
  id: string; recipient_name: string | null; sender_name: string | null; body: string;
  stationery: string | null; bgm: string | null; font: string | null; links: unknown;
  opened_count: number; created_at: string; seal_at: string;
};

async function toLetterView(row: LetterRow, photoPaths: string[]): Promise<LetterView> {
  const links = Array.isArray(row.links)
    ? (row.links as { label?: unknown; url?: unknown }[])
        .filter((l) => typeof l.url === "string" && /^https?:\/\//.test(l.url as string))
        .map((l) => ({ label: String(l.label ?? l.url), url: String(l.url) }))
    : [];
  return {
    id: row.id,
    recipientName: row.recipient_name,
    senderName: row.sender_name,
    body: row.body,
    stationery: row.stationery,
    bgm: row.bgm,
    font: row.font,
    links,
    photos: await signed(photoPaths),
    createdAt: row.created_at,
    sealed: new Date(row.seal_at) <= new Date(),
  };
}

const LETTER_COLS = "id, recipient_name, sender_name, body, stationery, bgm, font, links, opened_count, created_at, seal_at";

export async function resolveScan(rawCode: string): Promise<ScanView> {
  const parsed = parse(decodeURIComponent(rawCode));
  if (!(await allowScan(parsed.ok ? parsed.code : null))) return { kind: "rate_limited" };
  if (!parsed.ok) return { kind: "invalid" };
  const code = parsed.code;
  const db = adminClient();

  const { data: tag } = await db
    .from("tags")
    .select("code, status, batches(banner_image, banner_link)")
    .eq("code", code)
    .maybeSingle();
  if (!tag || tag.status === "void") return { kind: "unavailable" };

  const uid = await currentUserId();
  if (tag.status === "issued") return { kind: "unregistered", code, loggedIn: uid !== null };

  const { data: asset } = await db
    .from("assets")
    .select("id, owner_id, name, category, use_proof, use_letter, use_lost_contact, letter_public, status, lost_at, created_at, seal_at")
    .eq("tag_code", code)
    .single();
  if (!asset) return { kind: "unavailable" };

  const now = new Date();
  const sealed = new Date(asset.seal_at) <= now;

  // ── 소유자 ──────────────────────────────────────────────
  if (uid && uid === asset.owner_id) {
    const [{ data: proof }, { data: media }, { data: letters }, { data: events }, { data: transfer }, { data: threads }, { data: first }] =
      await Promise.all([
        db.from("proofs").select("store, purchased_on, price_krw, hide_price, warranty, serial_no").eq("asset_id", asset.id).maybeSingle(),
        db.from("media").select("kind, path, letter_id").eq("asset_id", asset.id).order("created_at"),
        db.from("letters").select(LETTER_COLS).eq("asset_id", asset.id).order("created_at", { ascending: false }),
        db.from("ownership_events").select("kind, created_at").eq("asset_id", asset.id).order("created_at"),
        db.from("transfers").select("token, mode, expires_at").eq("asset_id", asset.id)
          .is("accepted_at", null).is("cancelled_at", null).gt("expires_at", now.toISOString()).maybeSingle(),
        db.from("finder_threads").select("id, created_at, finder_messages(body, side, created_at, read_at)")
          .eq("asset_id", asset.id).order("created_at", { ascending: false }),
        db.rpc("is_first_owner", { p_asset: asset.id, p_user: uid }),
      ]);

    const isFirstOwner = first === true;
    const canSeePrice = isFirstOwner || (proof ? !proof.hide_price : false);
    const m = media ?? [];
    const receipts = canSeePrice ? m.filter((x) => x.kind === "receipt").map((x) => x.path) : [];

    return {
      kind: "owner",
      code,
      assetId: asset.id,
      name: asset.name,
      category: asset.category,
      useProof: asset.use_proof,
      useLetter: asset.use_letter,
      useLostContact: asset.use_lost_contact,
      letterPublic: asset.letter_public,
      status: asset.status,
      createdAt: asset.created_at,
      sealAt: asset.seal_at,
      sealed,
      isFirstOwner,
      proof: proof
        ? {
            store: proof.store,
            purchasedOn: proof.purchased_on,
            priceKrw: canSeePrice ? proof.price_krw : null,
            priceHidden: !canSeePrice,
            warranty: proof.warranty,
            serialNo: proof.serial_no,
            receiptPhotos: await signed(receipts),
          }
        : null,
      productPhotos: await signed(m.filter((x) => x.kind === "product").map((x) => x.path)),
      letters: await Promise.all(
        (letters ?? []).map(async (l) => ({
          ...(await toLetterView(l as LetterRow, m.filter((x) => x.letter_id === l.id).map((x) => x.path))),
          openedCount: l.opened_count,
        })),
      ),
      events: (events ?? []).map((e) => ({ kind: e.kind, at: e.created_at })),
      openTransfer: transfer ? { token: transfer.token, mode: transfer.mode, expiresAt: transfer.expires_at } : null,
      threads: (threads ?? []).map((t) => {
        const msgs = [...(t.finder_messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
        const last = msgs[msgs.length - 1];
        return {
          id: t.id,
          createdAt: t.created_at,
          lastBody: last?.body ?? "",
          lastSide: last?.side ?? "finder",
          unread: msgs.filter((x) => x.side === "finder" && !x.read_at).length,
        };
      }),
    };
  }

  // 공개 편지(가장 최근 것 하나)
  const latestLetter = async (): Promise<LetterView | null> => {
    if (!asset.use_letter || !asset.letter_public) return null;
    const { data: l } = await db.from("letters").select(LETTER_COLS).eq("asset_id", asset.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!l) return null;
    const { data: photos } = await db.from("media").select("path").eq("letter_id", l.id);
    await db.rpc("increment_letter_open", { p_letter: l.id });
    return toLetterView(l as LetterRow, (photos ?? []).map((p) => p.path));
  };

  // ── 진행 중인 선물: 받는 사람 화면 ───────────────────────
  const { data: gift } = await db.from("transfers").select("id").eq("asset_id", asset.id).eq("mode", "gift")
    .is("accepted_at", null).is("cancelled_at", null).gt("expires_at", now.toISOString()).maybeSingle();
  if (gift) {
    const { data: proof } = asset.use_proof
      ? await db.from("proofs").select("store, purchased_on, warranty").eq("asset_id", asset.id).maybeSingle()
      : { data: null };
    return {
      kind: "gift",
      code,
      name: asset.name,
      letter: await latestLetter(),
      proof: proof ? { store: proof.store, purchasedOn: proof.purchased_on, warranty: proof.warranty } : null,
      loggedIn: uid !== null,
    };
  }

  // ── 분실 신고 상태: 습득자 화면 ─────────────────────────
  if (asset.status === "lost") {
    const { data: photo } = await db.from("media").select("path").eq("asset_id", asset.id).eq("kind", "product")
      .order("created_at").limit(1).maybeSingle();
    return {
      kind: "lost",
      code,
      name: asset.name,
      category: asset.category,
      lostAt: asset.lost_at,
      photo: photo ? (await signed([photo.path]))[0] ?? null : null,
    };
  }

  // ── 그 외: 공개 화면 ────────────────────────────────────
  const batch = Array.isArray(tag.batches) ? tag.batches[0] : tag.batches;
  return {
    kind: "public",
    code,
    name: asset.name,
    letter: await latestLetter(),
    lostContact: asset.use_lost_contact,
    banner: batch && (batch.banner_image || batch.banner_link)
      ? { image: batch.banner_image ? (await signed([batch.banner_image]))[0] ?? null : null, link: batch.banner_link }
      : null,
  };
}
