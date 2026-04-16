import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nimiq.faucet.example',
  appName: 'Nimiq Faucet Example',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
