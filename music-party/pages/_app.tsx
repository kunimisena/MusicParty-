import "../styles/globals.css";
import type { AppProps } from "next/app";
import { ChakraProvider, extendTheme, type ThemeConfig } from "@chakra-ui/react";
import React, { useState, useEffect, useMemo } from 'react';

const themes = {
  default: {
    name: '亮色',
    colors: {
      bg: { 1: '#e8e8e8ff', 2: '#f8f0d7ff', 3: '#fdf9edff' },
      text: { 1: '#000000ff', 2: '#242321ff', 3: '#0083dbff' },
      buttonScheme: "gray",
    },
  },
  softDark: {
    name: '暗色',
    colors: {
      bg: { 1: '#000000ff', 2: '#3b3b3bff', 3: '#242422ff' },
      text: { 1: '#e5dfcbff', 2: '#b2ada0ff', 3: '#0083dbff' },
      buttonScheme: "whiteAlpha",
    },
  },
  sick: {
    name: '脑溢血',
    colors: {
      bg: { 1: '#ff0000ff', 2: '#33ff00ff', 3: '#1e00ffff' },
      text: { 1: '#f200ffff', 2: '#00ffd9ff', 3: '#00eeffff' },
      buttonScheme: "whiteAlpha",
    },
  }
};

export type ThemeKey = keyof typeof themes;

export const ThemeContext = React.createContext({
  themeKey: 'default' as ThemeKey,
  setThemeKey: (key: ThemeKey) => {},
  themes,
});

const THEME_STORAGE_KEY = 'music_party_theme';

const config: ThemeConfig = {
    initialColorMode: 'light',
    useSystemColorMode: false,
}

export default function App({ Component, pageProps }: AppProps) {
  const [themeKey, setThemeKey] = useState<ThemeKey>('default');

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeKey;
    if (savedTheme && themes[savedTheme]) {
      setThemeKey(savedTheme);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themeKey);
  }, [themeKey]);

  const chakraTheme = useMemo(() => {
    const currentTheme = themes[themeKey];
    return extendTheme({
      config,
      colors: {
        bg: currentTheme.colors.bg,
        text: currentTheme.colors.text,
      },
      styles: {
        global: {
          'html, body': {
            background: 'bg.1',
            color: 'text.1',
            transition: 'background-color 0.3s ease-in-out, color 0.3s ease-in-out',
          },
        },
      },
      components: {
        Heading: { baseStyle: { color: 'text.1' } },
        Text: { baseStyle: { color: 'text.1' } },
        Button: { defaultProps: { colorScheme: currentTheme.colors.buttonScheme, } },
        Card: { baseStyle: { container: { bg: 'bg.3' } } },
        Input: {
          variants: {
            outline: {
              field: {
                bg: 'bg.3',
                color: 'text.1', // [最终修复] 明确指定输入时的文字颜色
                _placeholder: { color: 'text.2' },
                _focusVisible: {
                    borderColor: 'text.3',
                    boxShadow: `0 0 0 1px var(--chakra-colors-text-3)`
                }
              }
            }
          }
        },
        List: {
            baseStyle: {
                item: { color: 'text.1', _hover: { bg: 'bg.2' } }
            }
        },
        Tabs: {
            variants: {
                'soft-rounded': {
                    tab: {
                        color: 'text.2',
                        _hover: { bg: 'bg.2' },
                        _selected: { color: 'text.1', bg: 'bg.3' },
                    },
                },
            },
        },
        Menu: {
            baseStyle: {
                list: {
                    bg: 'bg.3',
                    borderColor: 'bg.2'
                },
                item: {
                    bg: 'bg.3',
                    color: 'text.2',
                    _hover: {
                        bg: 'bg.2'
                    },
                    _focus: {
                        bg: 'bg.2'
                    }
                }
            }
        },
        Modal: { baseStyle: { dialog: { bg: 'bg.3' } } },
        Popover: { baseStyle: { content: { bg: 'bg.3' } } },
        Drawer: { baseStyle: { dialog: { bg: 'bg.3' } } },
        Divider: { baseStyle: { borderColor: 'bg.2' } },
        Accordion: {
            baseStyle: {
                button: {
                    color: 'text.1',
                    _hover: { bg: 'bg.2' }
                }
            }
        },
        Skeleton: {
            baseStyle: {
                _light: {
                    '--skeleton-start-color': 'bg.2',
                    '--skeleton-end-color': 'bg.3',
                },
                _dark: {
                    '--skeleton-start-color': 'bg.2',
                    '--skeleton-end-color': 'bg.3',
                }
            }
        }
      }
    });
  }, [themeKey]);

  return (
    <ThemeContext.Provider value={{ themeKey, setThemeKey, themes }}>
      <ChakraProvider theme={chakraTheme}>
        <Component {...pageProps} />
      </ChakraProvider>
    </ThemeContext.Provider>
  );
}

