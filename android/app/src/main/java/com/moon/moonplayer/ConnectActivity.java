package com.moon.moonplayer;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 连接页面 - 用户输入服务器地址
 */
public class ConnectActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "MoonPlayer";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_LAST_CONNECTED = "last_connected";

    private EditText urlInput;
    private Button connectButton;
    private ProgressBar progressBar;
    private TextView errorText;

    private ExecutorService executor;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 设置布局
        setContentView(R.layout.activity_connect);

        // 设置全屏
        setupFullscreen();

        // 获取控件
        urlInput = findViewById(R.id.urlInput);
        connectButton = findViewById(R.id.connectButton);
        progressBar = findViewById(R.id.progressBar);
        errorText = findViewById(R.id.errorText);

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        executor = Executors.newSingleThreadExecutor();

        // 加载上次地址
        String lastUrl = prefs.getString(KEY_SERVER_URL, "");
        if (!lastUrl.isEmpty()) {
            urlInput.setText(lastUrl);
        }

        connectButton.setOnClickListener(v -> attemptConnect());
    }

    private void setupFullscreen() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
    }

    private void attemptConnect() {
        String urlInputStr = urlInput.getText().toString().trim();

        if (urlInputStr.isEmpty()) {
            showError("请输入服务器地址");
            return;
        }

        // 验证 URL 格式
        final String url;
        if (!urlInputStr.startsWith("http://") && !urlInputStr.startsWith("https://")) {
            url = "http://" + urlInputStr;
            urlInput.setText(url);
        } else {
            url = urlInputStr;
        }

        // 隐藏键盘
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        imm.hideSoftInputFromWindow(urlInput.getWindowToken(), 0);

        setLoading(true);
        hideError();

        final String finalUrl = url;
        executor.execute(() -> {
            try {
                // 测试连接
                URL testUrl = new URL(finalUrl + "/api/auth/status");
                HttpURLConnection conn = (HttpURLConnection) testUrl.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestMethod("GET");

                int responseCode = conn.getResponseCode();
                conn.disconnect();

                if (responseCode == 200) {
                    // 连接成功，保存地址
                    runOnUiThread(() -> {
                        prefs.edit()
                            .putString(KEY_SERVER_URL, finalUrl)
                            .putLong(KEY_LAST_CONNECTED, System.currentTimeMillis())
                            .apply();

                        // 跳转到主页面
                        Intent intent = new Intent(ConnectActivity.this, MainActivity.class);
                        intent.putExtra("server_url", finalUrl);
                        startActivity(intent);
                        finish();
                    });
                } else {
                    runOnUiThread(() -> {
                        showError("服务器返回错误: " + responseCode);
                        setLoading(false);
                    });
                }
            } catch (Exception e) {
                runOnUiThread(() -> {
                    showError("连接失败: " + e.getMessage());
                    setLoading(false);
                });
            }
        });
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        connectButton.setEnabled(!loading);
        urlInput.setEnabled(!loading);
    }

    private void showError(String message) {
        errorText.setText(message);
        errorText.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        errorText.setVisibility(View.GONE);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (executor != null) {
            executor.shutdown();
        }
    }

    /**
     * 获取保存的服务器地址
     */
    public static String getSavedServerUrl(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_SERVER_URL, "");
    }
}