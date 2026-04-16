import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'media',
  content: ['./index.html', './src/**/*.{ts,vue}'],
  theme: {
    extend: {
      colors: {
        nimiq: {
          50: '#fff8e6',
          100: '#feeab3',
          200: '#fcdb80',
          300: '#fbcd4c',
          400: '#f9bf26',
          500: '#e9b213',
          600: '#c4940d',
          700: '#9a7209',
          800: '#6f5206',
          900: '#443103',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f5f4ef',
          dark: '#14110c',
          darkMuted: '#1d1a14',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
