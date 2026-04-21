package com.moon.moonplayer;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import org.json.JSONObject;

import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MoonPlayer";
    private static final String CHANNEL_ID = "moonplayer_media";
    private static final int NOTIFICATION_ID = 1001;
    
    // 默认服务器地址
    private static final String DEFAULT_URL = "";
    private static final String PREFS_NAME = "MoonPlayer";
    private static final String KEY_SERVER_URL = "server_url";
    
    private WebView webView;
    private MediaSessionCompat mediaSession;
    private NotificationManagerCompat notificationManager;
    private ExecutorService imageLoader = Executors.newSingleThreadExecutor();
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    
    // 当前播放状态
    private String currentTitle = "MoonPlayer";
    private String currentArtist = "";
    private boolean isPlaying = false;
    private long currentDuration = 0;
    private long currentPosition = 0;
    private String currentArtwork = "";
    
    // 广播接收器
    private BroadcastReceiver actionReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // 检查是否有服务器地址
        String url = getIntent().getStringExtra("server_url");
        if (url == null || url.isEmpty()) {
            url = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .getString(KEY_SERVER_URL, DEFAULT_URL);
        }
        
        // 如果没有地址，跳转到连接页面
        if (url == null || url.isEmpty()) {
            startActivity(new Intent(this, ConnectActivity.class));
            finish();
            return;
        }
        
        // 先设置 WebView（会调用 setContentView）
        setupWebView();
        // 全屏设置必须在 setContentView 之后
        setupFullscreen();
        createNotificationChannel();
        setupMediaSession();
        registerActionReceiver();
        
        webView.loadUrl(url);
    }

    private void setupFullscreen() {
        // 确保在 setContentView 之后调用
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
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

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "MoonPlayer 媒体控制",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("媒体播放状态和控制");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
        notificationManager = NotificationManagerCompat.from(this);
    }

    private void setupMediaSession() {
        mediaSession = new MediaSessionCompat(this, "MoonPlayer");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "MediaSession: onPlay");
                sendToWebView("play");
                isPlaying = true;
                updateNotification(currentArtwork);
            }
            
            @Override
            public void onPause() {
                Log.d(TAG, "MediaSession: onPause");
                sendToWebView("pause");
                isPlaying = false;
                updateNotification(currentArtwork);
            }
            
            @Override
            public void onSkipToNext() {
                Log.d(TAG, "MediaSession: onSkipToNext");
                sendToWebView("next");
            }
            
            @Override
            public void onSkipToPrevious() {
                Log.d(TAG, "MediaSession: onSkipToPrevious");
                sendToWebView("prev");
            }
            
            @Override
            public void onSeekTo(long pos) {
                Log.d(TAG, "MediaSession: onSeekTo " + pos);
                sendToWebView("seek", pos / 1000);
            }
            
            @Override
            public void onFastForward() {
                Log.d(TAG, "MediaSession: onFastForward");
                sendToWebView("forward");
            }
            
            @Override
            public void onRewind() {
                Log.d(TAG, "MediaSession: onRewind");
                sendToWebView("backward");
            }
        });
        mediaSession.setActive(true);
        
        startKeepAliveService();
    }
    
    // 注册广播接收器处理通知栏按钮
    private void registerActionReceiver() {
        actionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                
                Log.d(TAG, "ActionReceiver: " + action);
                
                switch (action) {
                    case "com.moon.moonplayer.play":
                        sendToWebView("play");
                        isPlaying = true;
                        updateNotification(currentArtwork);
                        break;
                    case "com.moon.moonplayer.pause":
                        sendToWebView("pause");
                        isPlaying = false;
                        updateNotification(currentArtwork);
                        break;
                    case "com.moon.moonplayer.next":
                        sendToWebView("next");
                        break;
                    case "com.moon.moonplayer.prev":
                        sendToWebView("prev");
                        break;
                    case "com.moon.moonplayer.forward":
                        sendToWebView("forward");
                        break;
                    case "com.moon.moonplayer.backward":
                        sendToWebView("backward");
                        break;
                }
            }
        };
        
        IntentFilter filter = new IntentFilter();
        filter.addAction("com.moon.moonplayer.play");
        filter.addAction("com.moon.moonplayer.pause");
        filter.addAction("com.moon.moonplayer.next");
        filter.addAction("com.moon.moonplayer.prev");
        filter.addAction("com.moon.moonplayer.forward");
        filter.addAction("com.moon.moonplayer.backward");
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(actionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(actionReceiver, filter);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = new WebView(this);
        setContentView(webView);
        
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        webView.addJavascriptInterface(new MoonPlayerInterface(), "MoonPlayerApp");
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    view.loadUrl(url);
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
            
            @Override
            public void onPageFinished(WebView view, String url) {
                injectBridge();
            }
        });
        
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    request.grant(request.getResources());
                }
            }
        });
    }

    private void injectBridge() {
        String js = "window.MoonPlayerNative = {" +
            "  updateMedia: function(data) { MoonPlayerApp.updateMedia(JSON.stringify(data)); }," +
            "  play: function() { MoonPlayerApp.play(); }," +
            "  pause: function() { MoonPlayerApp.pause(); }," +
            "  next: function() { MoonPlayerApp.next(); }," +
            "  prev: function() { MoonPlayerApp.prev(); }," +
            "  forward: function() { MoonPlayerApp.forward(); }," +
            "  backward: function() { MoonPlayerApp.backward(); }," +
            "  seek: function(pos) { MoonPlayerApp.seek(pos); }" +
            "};";
        webView.evaluateJavascript(js, null);
    }

    private void sendToWebView(String cmd) {
        sendToWebView(cmd, 0);
    }
    
    private void sendToWebView(String cmd, long param) {
        mainHandler.post(() -> {
            String js;
            switch (cmd) {
                case "play":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.play) window.MoonPlayerBridge.play();";
                    break;
                case "pause":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.pause) window.MoonPlayerBridge.pause();";
                    break;
                case "next":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.next) window.MoonPlayerBridge.next();";
                    break;
                case "prev":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.prev) window.MoonPlayerBridge.prev();";
                    break;
                case "forward":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.forward) window.MoonPlayerBridge.forward();";
                    break;
                case "backward":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.backward) window.MoonPlayerBridge.backward();";
                    break;
                case "seek":
                    js = "if (window.MoonPlayerBridge && window.MoonPlayerBridge.seek) window.MoonPlayerBridge.seek(" + param + ");";
                    break;
                default:
                    js = "";
            }
            if (!js.isEmpty()) {
                Log.d(TAG, "Sending to WebView: " + cmd);
                webView.evaluateJavascript(js, null);
            }
        });
    }

    public class MoonPlayerInterface {
        @JavascriptInterface
        public void updateMedia(String json) {
            try {
                JSONObject data = new JSONObject(json);
                String title = data.optString("title", "MoonPlayer");
                String artist = data.optString("artist", "");
                long duration = data.optLong("duration", 0);
                long position = data.optLong("position", 0);
                boolean playing = data.optBoolean("isPlaying", false);
                String artwork = data.optString("artwork", "");
                
                // 只有变化时才更新通知
                boolean changed = !title.equals(currentTitle) || 
                                   !artist.equals(currentArtist) ||
                                   playing != isPlaying ||
                                   Math.abs(duration - currentDuration) > 1;
                
                currentTitle = title;
                currentArtist = artist;
                currentDuration = duration;
                currentPosition = position;
                isPlaying = playing;
                currentArtwork = artwork;
                
                updateMediaSession();
                
                if (changed || !artwork.isEmpty()) {
                    updateNotification(artwork);
                }
            } catch (Exception e) {
                Log.e(TAG, "updateMedia error", e);
            }
        }
        
        @JavascriptInterface
        public void play() {
            isPlaying = true;
            updateMediaSession();
            updateNotification(currentArtwork);
        }
        
        @JavascriptInterface
        public void pause() {
            isPlaying = false;
            updateMediaSession();
            updateNotification(currentArtwork);
        }
        
        @JavascriptInterface
        public void next() {
            sendToWebView("next");
        }
        
        @JavascriptInterface
        public void prev() {
            sendToWebView("prev");
        }
        
        @JavascriptInterface
        public void forward() {
            sendToWebView("forward");
        }
        
        @JavascriptInterface
        public void backward() {
            sendToWebView("backward");
        }
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;
        
        MediaMetadataCompat.Builder metadata = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist);
        
        if (currentDuration > 0) {
            metadata.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration * 1000);
        }
        
        mediaSession.setMetadata(metadata.build());
        
        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        
        PlaybackStateCompat.Builder playbackState = new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY | 
                PlaybackStateCompat.ACTION_PAUSE | 
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_FAST_FORWARD |
                PlaybackStateCompat.ACTION_REWIND |
                PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(state, currentPosition * 1000, 1.0f);
        
        mediaSession.setPlaybackState(playbackState.build());
        mediaSession.setActive(true);
    }

    private void updateNotification(String artworkUrl) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(isPlaying)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(createPendingIntent());
        
        // 按钮顺序：后退、前进、上一曲、播放/暂停、下一曲
        // CompactView 显示前 3 个（后退、前进、播放/暂停）
        builder.addAction(R.drawable.ic_backward, "后退", createActionIntent("backward"));
        builder.addAction(R.drawable.ic_forward, "前进", createActionIntent("forward"));
        builder.addAction(R.drawable.ic_prev, "上一曲", createActionIntent("prev"));
        
        if (isPlaying) {
            builder.addAction(R.drawable.ic_pause, "暂停", createActionIntent("pause"));
        } else {
            builder.addAction(R.drawable.ic_play, "播放", createActionIntent("play"));
        }
        
        builder.addAction(R.drawable.ic_next, "下一曲", createActionIntent("next"));
        
        MediaStyle style = new MediaStyle()
            .setMediaSession(mediaSession.getSessionToken())
            .setShowActionsInCompactView(0, 1, 3); // 显示：后退、前进、播放/暂停
        builder.setStyle(style);
        
        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            loadArtworkAsync(artworkUrl, builder);
        } else {
            notificationManager.notify(NOTIFICATION_ID, builder.build());
        }
    }

    private void loadArtworkAsync(String url, NotificationCompat.Builder builder) {
        imageLoader.execute(() -> {
            try {
                Bitmap bitmap = BitmapFactory.decodeStream(new URL(url).openStream());
                if (bitmap != null) {
                    mainHandler.post(() -> {
                        builder.setLargeIcon(bitmap);
                        notificationManager.notify(NOTIFICATION_ID, builder.build());
                    });
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to load artwork", e);
            }
        });
    }

    private PendingIntent createPendingIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent createActionIntent(String action) {
        Intent intent = new Intent("com.moon.moonplayer." + action);
        return PendingIntent.getBroadcast(this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void startKeepAliveService() {
        Intent intent = new Intent(this, MediaKeepService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mediaSession != null) {
            mediaSession.setActive(true);
        }
    }

    @Override
    protected void onDestroy() {
        if (actionReceiver != null) {
            unregisterReceiver(actionReceiver);
        }
        if (isFinishing()) {
            mediaSession.setActive(false);
            mediaSession.release();
            stopService(new Intent(this, MediaKeepService.class));
            imageLoader.shutdown();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }
}