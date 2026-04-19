import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,vue}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#fcf9f3',
          'container-lowest': '#ffffff',
          'container-low': '#f6f3ed',
          container: '#f1ede7',
          'container-high': '#ebe8e2',
          'container-highest': '#e5e2dc',
          bright: '#fcf9f3',
          dim: '#dcdad4',
        },
        'on-surface': {
          DEFAULT: '#1c1c18',
          variant: '#4f4633',
        },
        primary: {
          DEFAULT: '#785a00',
          container: '#e9b213',
          fixed: '#ffdf9c',
          'fixed-dim': '#f7be25',
        },
        'on-primary': {
          DEFAULT: '#ffffff',
          container: '#5f4600',
          fixed: '#251a00',
          'fixed-variant': '#5b4300',
        },
        secondary: {
          DEFAULT: '#575b84',
          container: '#cbcefd',
          fixed: '#dfe0ff',
          'fixed-dim': '#c0c3f2',
        },
        tertiary: {
          DEFAULT: '#005db8',
          container: '#95bbff',
          fixed: '#d6e3ff',
        },
        'on-tertiary-container': '#004993',
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
        },
        'on-error': '#ffffff',
        outline: {
          DEFAULT: '#817661',
          variant: '#d3c5ad',
        },
        'inverse-surface': '#31302d',
        'inverse-on-surface': '#f3f0ea',
        'inverse-primary': '#f7be25',
        // Legacy nimiq shades for existing component compatibility
        nimiq: {
          500: '#e9b213',
          400: '#f7be25',
        },
      },
      fontFamily: {
        headline: ['Plus Jakarta Sans', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
        label: ['Space Grotesk', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
      borderRadius: {
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 10px 40px rgba(31, 35, 72, 0.06)',
        'soft-sm': '0 10px 40px rgba(31, 35, 72, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
