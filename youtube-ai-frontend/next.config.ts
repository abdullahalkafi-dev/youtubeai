import type { NextConfig } from "next";

const backendUrl =
  process.env.INTERNAL_API_URL ||
  (process.env.NODE_ENV === 'production' ? 'http://backend:5001' : 'http://localhost:5001');

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/thumbnails/:path*',
        destination: `${backendUrl}/api/assets/minio/:path*`,
      },
    ];
  },
};

export default nextConfig;
