import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@simrs/ui'],
  poweredByHeader: false,
  typedRoutes: false,
};

export default nextConfig;
