import path from 'node:path'
import type { NextConfig } from 'next'
import { codeInspectorPlugin } from 'code-inspector-plugin'

const nextConfig: NextConfig = {
  experimental: {
    swcPlugins: [['@lingui/swc-plugin', {}]],
  },
  turbopack: {
    root: path.join(__dirname, '../..'),
    rules: codeInspectorPlugin({
      bundler: 'turbopack',
      hotKeys: ['altKey'], // 只使用 Option/Alt 键，去掉 Shift
    }),
  },
}

export default nextConfig
