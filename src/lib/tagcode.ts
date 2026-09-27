/**
 * 미미태그 코드 체계
 *
 *   S 7K3M9QX2 P
 *   │ └──┬───┘ └ 검증 문자(Luhn mod 32)
 *   │  랜덤 8자
 *   └ 발행유형 (S 스티커 / P 제품 부착 / M 판촉·단체)
 *
 * 문자 집합은 Crockford Base32(0-9, A-Z 에서 I L O U 제외).
 * QR 영숫자 모드에 들어가는 글자만 쓰므로 QR 칸 수가 작아진다.
 */

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;
export const ISSUE_TYPES = ["S", "P", "M"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const RANDOM_LENGTH = 8;
export const CODE_LENGTH = 1 + RANDOM_LENGTH + 1;

const N = ALPHABET.length; // 32

function valueOf(ch: string): number {
  const i = ALPHABET.indexOf(ch);
  if (i < 0) throw new Error(`허용되지 않는 문자: ${ch}`);
  return i;
}

/** Luhn mod N 검증 문자. 한 글자 틀림과 대부분의 인접 글자 뒤바뀜을 잡아낸다. */
export function checkChar(body: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    let addend = factor * valueOf(body[i]);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  const remainder = sum % N;
  return ALPHABET[(N - remainder) % N];
}

/** 사람이 입력하거나 URL 에서 온 값을 표준형으로. 헷갈리는 글자는 Crockford 규칙대로 바꾼다. */
export function normalize(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export type ParseResult =
  | { ok: true; code: string; issueType: IssueType }
  | { ok: false; reason: "length" | "type" | "charset" | "check" };

export function parse(input: string): ParseResult {
  const code = normalize(input);
  if (code.length !== CODE_LENGTH) return { ok: false, reason: "length" };
  const type = code[0] as IssueType;
  if (!ISSUE_TYPES.includes(type)) return { ok: false, reason: "type" };
  for (const ch of code) if (!ALPHABET.includes(ch as never)) {
    return { ok: false, reason: "charset" };
  }
  const body = code.slice(0, -1);
  if (checkChar(body) !== code[code.length - 1]) return { ok: false, reason: "check" };
  return { ok: true, code, issueType: type };
}

/** 암호학적 난수로 코드 하나 생성 */
export function generate(issueType: IssueType, randomBytes: (n: number) => Uint8Array): string {
  // 32 = 2^5 이므로 바이트를 32로 나눈 나머지를 써도 치우침이 없다
  const bytes = randomBytes(RANDOM_LENGTH);
  let body: string = issueType;
  for (let i = 0; i < RANDOM_LENGTH; i++) body += ALPHABET[bytes[i] % N];
  return body + checkChar(body);
}

/** 중복 없이 n개 생성 (DB 유일 제약이 최종 보증) */
export function generateMany(
  issueType: IssueType,
  n: number,
  randomBytes: (n: number) => Uint8Array,
): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(generate(issueType, randomBytes));
  return [...set];
}

/** QR 에 넣을 URL. 영숫자 모드가 되도록 전부 대문자. */
export function tagUrl(code: string, host: string): string {
  return `HTTPS://${host.toUpperCase()}/${code}`;
}

/** QR 영숫자 모드에 들어가는 문자열인지 */
export function isQrAlphanumeric(s: string): boolean {
  return /^[0-9A-Z $%*+\-./:]*$/.test(s);
}

/**
 * 영숫자 모드 기준 최소 QR 버전 (1~4 만 계산, 오류정정 수준별).
 * ISO/IEC 18004 용량표: 버전별 영숫자 최대 글자 수.
 */
const ALNUM_CAPACITY: Record<"L" | "M" | "Q" | "H", number[]> = {
  L: [25, 47, 77, 114],
  M: [20, 38, 61, 90],
  Q: [16, 29, 47, 67],
  H: [10, 20, 35, 50],
};

export function minQrVersion(s: string, ecc: "L" | "M" | "Q" | "H"): number | null {
  if (!isQrAlphanumeric(s)) return null;
  const caps = ALNUM_CAPACITY[ecc];
  const idx = caps.findIndex((c) => s.length <= c);
  return idx < 0 ? null : idx + 1;
}

/** 버전 → 한 변의 칸 수 */
export const modulesFor = (version: number) => 17 + 4 * version;
