import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 사진 업로드(최대 5MB) 를 서버 액션으로 받는다
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
