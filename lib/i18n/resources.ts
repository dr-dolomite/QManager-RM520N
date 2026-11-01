import enCommon from "@/public/locales/en/common.json";
import enSidebar from "@/public/locales/en/sidebar.json";
import enDashboard from "@/public/locales/en/dashboard.json";
import enCellular from "@/public/locales/en/cellular.json";
import enSystemSettings from "@/public/locales/en/system-settings.json";
import enSystemHealthCheck from "@/public/locales/en/system-health-check.json";
import enErrors from "@/public/locales/en/errors.json";
import enOnboarding from "@/public/locales/en/onboarding.json";
import enLocalNetwork from "@/public/locales/en/local-network.json";
import zhCNCommon from "@/public/locales/zh-CN/common.json";
import zhCNSidebar from "@/public/locales/zh-CN/sidebar.json";
import zhCNDashboard from "@/public/locales/zh-CN/dashboard.json";
import zhCNCellular from "@/public/locales/zh-CN/cellular.json";
import zhCNSystemSettings from "@/public/locales/zh-CN/system-settings.json";
import zhCNSystemHealthCheck from "@/public/locales/zh-CN/system-health-check.json";
import zhCNErrors from "@/public/locales/zh-CN/errors.json";
import zhCNOnboarding from "@/public/locales/zh-CN/onboarding.json";
import zhCNLocalNetwork from "@/public/locales/zh-CN/local-network.json";
import zhTWCommon from "@/public/locales/zh-TW/common.json";
import zhTWSidebar from "@/public/locales/zh-TW/sidebar.json";
import zhTWDashboard from "@/public/locales/zh-TW/dashboard.json";
import zhTWCellular from "@/public/locales/zh-TW/cellular.json";
import zhTWSystemSettings from "@/public/locales/zh-TW/system-settings.json";
import zhTWSystemHealthCheck from "@/public/locales/zh-TW/system-health-check.json";
import zhTWErrors from "@/public/locales/zh-TW/errors.json";
import zhTWOnboarding from "@/public/locales/zh-TW/onboarding.json";
import zhTWLocalNetwork from "@/public/locales/zh-TW/local-network.json";
import itCommon from "@/public/locales/it/common.json";
import itSidebar from "@/public/locales/it/sidebar.json";
import itDashboard from "@/public/locales/it/dashboard.json";
import itCellular from "@/public/locales/it/cellular.json";
import itSystemSettings from "@/public/locales/it/system-settings.json";
import itSystemHealthCheck from "@/public/locales/it/system-health-check.json";
import itErrors from "@/public/locales/it/errors.json";
import itOnboarding from "@/public/locales/it/onboarding.json";
import itLocalNetwork from "@/public/locales/it/local-network.json";
import idCommon from "@/public/locales/id/common.json";
import idSidebar from "@/public/locales/id/sidebar.json";
import idDashboard from "@/public/locales/id/dashboard.json";
import idCellular from "@/public/locales/id/cellular.json";
import idSystemSettings from "@/public/locales/id/system-settings.json";
import idSystemHealthCheck from "@/public/locales/id/system-health-check.json";
import idErrors from "@/public/locales/id/errors.json";
import idOnboarding from "@/public/locales/id/onboarding.json";
import idLocalNetwork from "@/public/locales/id/local-network.json";

// Static resources for i18next. Every bundled language declares every namespace.
// Bundle-only: the whole locale catalog rides the existing out/ → www deploy
// path, so nothing is fetched at runtime.
export const resources = {
  en: {
    common: enCommon,
    sidebar: enSidebar,
    dashboard: enDashboard,
    cellular: enCellular,
    "system-settings": enSystemSettings,
    "system-health-check": enSystemHealthCheck,
    errors: enErrors,
    onboarding: enOnboarding,
    "local-network": enLocalNetwork,
  },
  "zh-CN": {
    common: zhCNCommon,
    sidebar: zhCNSidebar,
    dashboard: zhCNDashboard,
    cellular: zhCNCellular,
    "system-settings": zhCNSystemSettings,
    "system-health-check": zhCNSystemHealthCheck,
    errors: zhCNErrors,
    onboarding: zhCNOnboarding,
    "local-network": zhCNLocalNetwork,
  },
  "zh-TW": {
    common: zhTWCommon,
    sidebar: zhTWSidebar,
    dashboard: zhTWDashboard,
    cellular: zhTWCellular,
    "system-settings": zhTWSystemSettings,
    "system-health-check": zhTWSystemHealthCheck,
    errors: zhTWErrors,
    onboarding: zhTWOnboarding,
    "local-network": zhTWLocalNetwork,
  },
  it: {
    common: itCommon,
    sidebar: itSidebar,
    dashboard: itDashboard,
    cellular: itCellular,
    "system-settings": itSystemSettings,
    "system-health-check": itSystemHealthCheck,
    errors: itErrors,
    onboarding: itOnboarding,
    "local-network": itLocalNetwork,
  },
  id: {
    common: idCommon,
    sidebar: idSidebar,
    dashboard: idDashboard,
    cellular: idCellular,
    "system-settings": idSystemSettings,
    "system-health-check": idSystemHealthCheck,
    errors: idErrors,
    onboarding: idOnboarding,
    "local-network": idLocalNetwork,
  },
} as const;

export const DEFAULT_NAMESPACE = "common" as const;
export const ALL_NAMESPACES = ["common", "sidebar", "dashboard", "cellular", "system-settings", "system-health-check", "errors", "onboarding", "local-network"] as const;
