import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import App from './App'
import 'antd/dist/reset.css'
import './index.css'

const awsTheme = {
  token: {
    colorPrimary: '#ec7211',
    colorLink: '#0073bb',
    colorLinkHover: '#005fa5',
    colorSuccess: '#1d8348',
    colorWarning: '#d68910',
    colorError: '#c0392b',
    colorBgLayout: '#f2f3f3',
    colorBgContainer: '#ffffff',
    colorBorder: '#aab7b8',
    colorBorderSecondary: '#e5e7e8',
    colorText: '#0f1111',
    colorTextSecondary: '#545b64',
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    fontFamily: "'Amazon Ember', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: 14,
    boxShadow: '0 1px 3px rgba(0,28,36,.1), 0 1px 2px rgba(0,28,36,.06)',
    boxShadowSecondary: '0 4px 12px rgba(0,28,36,.12)',
  },
  components: {
    Layout: {
      headerBg: '#232f3e',
      siderBg: '#ffffff',
      bodyBg: '#f2f3f3',
      footerBg: '#f2f3f3',
    },
    Menu: {
      darkItemBg: '#1a2433',
      darkSubMenuItemBg: '#16202d',
      darkItemSelectedBg: '#0073bb',
      darkItemHoverBg: '#253044',
      darkItemColor: '#d5dbdb',
      darkItemSelectedColor: '#ffffff',
    },
    Table: {
      headerBg: '#f8f9fa',
      headerColor: '#0f1111',
      headerSortActiveBg: '#edf0f2',
      headerSortHoverBg: '#e8ecef',
      borderColor: '#e8eaed',
      rowHoverBg: '#f7f8f8',
      fontSize: 13,
      cellPaddingBlock: 9,
      cellPaddingInline: 16,
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
    },
    Button: {
      defaultBorderColor: '#aab7b8',
      primaryShadow: 'none',
      defaultShadow: 'none',
    },
    Card: {
      headerBg: '#f8f9fa',
    },
    Modal: {
      headerBg: '#ffffff',
      titleFontSize: 15,
    },
    Drawer: {
      footerPaddingBlock: 12,
    },
    Breadcrumb: {
      linkColor: '#0073bb',
      lastItemColor: '#545b64',
      separatorColor: '#aab7b8',
    },
    Input: {
      activeShadow: '0 0 0 2px rgba(0,115,187,.2)',
    },
    Select: {
      optionSelectedBg: '#e6f4ff',
    },
    Tag: {
      defaultBg: '#f0f2f4',
      defaultColor: '#0f1111',
    },
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={awsTheme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
