// Opening a chat link: the app is the only surface that can turn a URL into a
// browser tab. RN's Linking.openURL rejects when nothing can handle the URL, so
// the rejection is the "nothing opened" signal — the library default only
// logged it and the tap looked dead (upstream #284).
//
// No canOpenURL guard on purpose: on Android 11+ it is filtered by the
// manifest's <queries>, and the Expo template declares only the https scheme,
// so every http URL (localhost, a LAN dev server) answered false and never
// opened. Starting the activity is not filtered that way; the scheme allowlist
// in linkify.ts is what actually needs to be checked.
import { Alert, Linking } from "react-native"
import * as Clipboard from "expo-clipboard"
import i18n from "../../lib/i18n/config"
import { isAllowedLinkScheme } from "../../lib/linkify"

function showLinkFallback(url: string): void {
  Alert.alert(i18n.t("chat.link.openFailedTitle"), url, [
    { text: i18n.t("chat.link.copy"), onPress: () => void Clipboard.setStringAsync(url) },
    { text: i18n.t("common.cancel"), style: "cancel" },
  ])
}

export function openLink(url: string): void {
  if (!isAllowedLinkScheme(url)) {
    showLinkFallback(url)
    return
  }
  void Linking.openURL(url).catch(() => showLinkFallback(url))
}
