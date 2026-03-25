import React from "react";
import { SafeAreaView, StatusBar, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

const LIVE_URL = "https://YOUR-LIVE-SITE-OR-VERCEL-URL";

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <WebView
        source={{ uri: LIVE_URL }}
        style={styles.webview}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f9fc"
  },
  webview: {
    flex: 1
  }
});
