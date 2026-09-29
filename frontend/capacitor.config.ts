import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.immoplatformpro.app',
  appName: 'ImmoPlatform Pro',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
