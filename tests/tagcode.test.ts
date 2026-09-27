import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ALPHABET, CODE_LENGTH, checkChar, generate, generateMany, isQrAlphanumeric,
  minQrVersion, modulesFor, normalize, parse, tagUrl,
} from "../src/lib/tagcode";

const rb = (n: number) => new Uint8Array(randomBytes(n));

test("생성된 코드는 항상 검증을 통과한다", () => {
  for (const t of ["S", "P", "M"] as const) {
    for (let i = 0; i < 2000; i++) {
      const c = generate(t, rb);
      assert.equal(c.length, CODE_LENGTH);
      const r = parse(c);
      assert.ok(r.ok, `${c} 실패`);
      if (r.ok) assert.equal(r.issueType, t);
    }
  }
});

test("DB 제약 정규식과 일치한다", () => {
  const re = /^[SPM][0-9A-HJKMNP-TV-Z]{9}$/;
  for (let i = 0; i < 2000; i++) assert.match(generate("S", rb), re);
});

test("한 글자 오타는 모두 잡는다", () => {
  for (let k = 0; k < 200; k++) {
    const c = generate("S", rb);
    for (let pos = 1; pos < c.length; pos++) {
      for (const ch of ALPHABET) {
        if (ch === c[pos]) continue;
        const bad = c.slice(0, pos) + ch + c.slice(pos + 1);
        assert.equal(parse(bad).ok, false, `${c} → ${bad} 통과됨`);
      }
    }
  }
});

test("인접 글자 뒤바뀜을 대부분 잡는다", () => {
  let total = 0, caught = 0;
  for (let k = 0; k < 2000; k++) {
    const c = generate("S", rb);
    for (let pos = 1; pos < c.length - 1; pos++) {
      if (c[pos] === c[pos + 1]) continue;
      const sw = c.slice(0, pos) + c[pos + 1] + c[pos] + c.slice(pos + 2);
      total++;
      if (!parse(sw).ok) caught++;
    }
  }
  assert.ok(caught / total > 0.95, `뒤바뀜 검출률 ${(caught / total * 100).toFixed(1)}%`);
});

test("입력 정규화: 소문자·공백·하이픈·헷갈리는 글자", () => {
  const c = generate("S", rb);
  const messy = ` ${c.slice(0, 5).toLowerCase()}-${c.slice(5)} `;
  assert.equal(normalize(messy), c);
  assert.equal(normalize("o"), "0");
  assert.equal(normalize("il"), "11");
});

test("형식 오류 이유", () => {
  assert.deepEqual(parse("S123"), { ok: false, reason: "length" });
  assert.deepEqual(parse("X" + "0".repeat(9)), { ok: false, reason: "type" });
});

test("검증 문자는 결정적이다", () => {
  assert.equal(checkChar("S7K3M9QX2"), checkChar("S7K3M9QX2"));
});

test("QR: 짧은 도메인이면 버전 2(25×25칸), 오류정정 M 에 들어간다", () => {
  const url = tagUrl(generate("S", rb), "mimitag.kr");
  assert.ok(isQrAlphanumeric(url), url);
  assert.equal(minQrVersion(url, "M"), 2);
  assert.equal(modulesFor(2), 25);
});

test("QR: 소문자 URL 은 영숫자 모드가 아니다(칸이 늘어난다)", () => {
  assert.equal(isQrAlphanumeric("https://mimitag.kr/S7K3M9QX2P"), false);
});

test("QR: 레떼즈 기존 주소는 ?, = 때문에 영숫자 모드가 불가능하다", () => {
  // 바이트 모드가 되어 같은 오류정정 수준에서 더 큰 QR(버전 3 이상)이 필요하다.
  assert.equal(minQrVersion("HTTPS://LETTEZ.NET/?SNO=Z0ZBIKKTBGRXLBUU", "M"), null);
});

test("여러 개 생성 시 중복 없음", () => {
  const list = generateMany("S", 5000, rb);
  assert.equal(new Set(list).size, 5000);
});
