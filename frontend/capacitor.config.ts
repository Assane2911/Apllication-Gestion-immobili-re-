import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.votredomaine.immoplatform',
  appName: 'ImmoPlatform Pro',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
