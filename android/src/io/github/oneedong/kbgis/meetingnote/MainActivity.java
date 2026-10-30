package io.github.oneedong.kbgis.meetingnote;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * KB GIS Meeting Note — 웹앱을 전체 화면 WebView 로 연다.
 * 화면·데이터는 모두 웹앱(GitHub Pages)에서 오므로, DB 가 갱신돼도 이 앱은 다시 설치할 필요가 없다.
 * 앱 주소 밖의 링크는 기본 브라우저로 넘긴다.
 */
public class MainActivity extends Activity {
    static final String HOST = "oneedong.github.io";
    static final String PATH = "/KB-GIS-Meeting-Note";
    static final String HOME = "https://" + HOST + PATH + "/";

    // 처음 실행인데 인터넷이 안 될 때 (한 번 열고 나면 서비스워커가 오프라인에서도 연다)
    static final String OFFLINE =
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        + "<body style='margin:0;font-family:sans-serif;background:#F7F6F3;color:#2A2621;display:grid;place-items:center;min-height:100vh;text-align:center'>"
        + "<div style='padding:24px'><div style='width:52px;height:52px;border-radius:14px;background:#FFBC00;color:#3A342C;font:700 19px/52px sans-serif;margin:0 auto 14px'>KB</div>"
        + "<b style='font-size:18px'>인터넷에 연결되지 않았습니다</b>"
        + "<p style='color:#7A7266;font-size:14px;line-height:1.6'>처음 한 번은 인터넷이 필요합니다.<br>연결을 확인한 뒤 다시 시도해 주세요.</p>"
        + "<a href='" + HOME + "' style='display:inline-block;margin-top:6px;padding:12px 22px;border-radius:10px;background:#FFBC00;color:#2A2621;font-weight:700;text-decoration:none'>다시 시도</a></div>";

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // IndexedDB·localStorage (기기에 기억된 키)
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isApp(u)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) view.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null);
            }
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    static boolean isApp(Uri u) {
        String path = u.getPath();
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost()) && path != null && path.startsWith(PATH);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
