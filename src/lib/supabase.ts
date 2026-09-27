import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * 로그인한 사용자 권한으로 동작하는 클라이언트.
 * RLS 와 DB 함수의 auth.uid() 검사가 그대로 적용된다.
 */
export async function userClient() {
  const store = await cookies();
  return createServerClient(url(), anonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 미들웨어가 세션을 갱신한다.
        }
      },
    },
  });
}

/**
 * 서버 전용 관리자 클라이언트(RLS 우회).
 * 규칙: 이 클라이언트로 읽은 행을 그대로 화면에 내보내지 않는다.
 * 반드시 src/lib/scan.ts 처럼 필요한 필드만 골라서 넘긴다.
 */
export function adminClient() {
  return createPlainClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function currentUserId(): Promise<string | null> {
  const supabase = await userClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
