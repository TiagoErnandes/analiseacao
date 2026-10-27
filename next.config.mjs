/** @type {import('next').NextConfig} */
const nextConfig = {
  // Planilhas da B3 sobem por server action; o padrão (1 MB) é pouco para extratos longos.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
export default nextConfig;
