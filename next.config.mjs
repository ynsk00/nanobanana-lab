/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画像をbase64でやり取りするため、APIルートのボディ上限を引き上げる
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
