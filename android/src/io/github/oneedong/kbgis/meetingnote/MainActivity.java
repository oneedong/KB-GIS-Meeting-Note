package io.github.oneedong.kbgis.meetingnote;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * KB GIS Meeting Note — 웹앱을 전체 화면 WebView 로 연다.
 * 화면·데이터는 모두 웹앱(GitHub Pages)에서 오므로, DB 가 갱신돼도 이 앱은 다시 설치할 필요가 없다.
 * 앱 주소 밖의 링크는 기본 브라우저로 넘긴다.
 * WebView 는 파일 내려받기를 스스로 못 하므로, 웹앱이 만든 PDF(리서치 요약 A4 1쪽)는
 * window.KBApp.savePdf(이름, base64) 로 넘겨받아 '다운로드' 폴더에 저장한다(안드로이드 9 이하는 인쇄 화면의 'PDF로 저장').
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

        web.addJavascriptInterface(new Bridge(), "KBApp");

        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    /** 웹앱 → 앱. 앱 주소의 페이지만 이 WebView 에 열린다(다른 주소는 브라우저로 넘김). */
    class Bridge {
        @JavascriptInterface
        public int version() {
            return 2;
        }

        @JavascriptInterface
        public void savePdf(final String name, final String base64) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.savePdf(name, base64);
                }
            });
        }
    }

    void savePdf(String name, String base64) {
        try {
            final byte[] data = Base64.decode(base64, Base64.DEFAULT);
            if (data.length < 5 || data[0] != '%' || data[1] != 'P' || data[2] != 'D' || data[3] != 'F') throw new IllegalArgumentException("not a pdf");
            String safe = (name == null ? "report" : name).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (!safe.toLowerCase().endsWith(".pdf")) safe += ".pdf";
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                v.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("insert failed");
                OutputStream os = getContentResolver().openOutputStream(uri);
                try {
                    os.write(data);
                } finally {
                    os.close();
                }
                Toast.makeText(this, "다운로드 폴더에 저장했습니다\n" + safe, Toast.LENGTH_LONG).show();
                try {
                    Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(view, safe));
                } catch (Exception ignored) {
                    // PDF 를 여는 앱이 없어도 파일은 저장돼 있다
                }
            } else {
                printPdf(safe, data);
            }
        } catch (Exception e) {
            Toast.makeText(this, "PDF를 저장하지 못했습니다", Toast.LENGTH_LONG).show();
        }
    }

    /** 안드로이드 9 이하: 저장 권한 없이 쓰려고 인쇄 화면을 띄운다 — 프린터 대신 'PDF로 저장'을 고르면 된다. */
    void printPdf(final String name, final byte[] data) {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        pm.print(name, new PrintDocumentAdapter() {
            @Override
            public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs, CancellationSignal signal, LayoutResultCallback cb, Bundle extras) {
                if (signal.isCanceled()) {
                    cb.onLayoutCancelled();
                    return;
                }
                cb.onLayoutFinished(new PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(1).build(), true);
            }

            @Override
            public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal signal, WriteResultCallback cb) {
                try {
                    OutputStream os = new FileOutputStream(dest.getFileDescriptor());
                    try {
                        os.write(data);
                    } finally {
                        os.close();
                    }
                    cb.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                } catch (Exception e) {
                    cb.onWriteFailed(e.getMessage());
                }
            }
        }, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
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
