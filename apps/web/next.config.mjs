/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: [
    '@designbao/db',
    '@designbao/domain',
    '@designbao/importer',
    '@designbao/storage',
  ],
  serverExternalPackages: ['@prisma/client', 'prisma'],
};

export default nextConfig;
