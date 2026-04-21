package com.moon.moonplayer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 接收通知栏按钮点击事件
 */
public class MediaActionReceiver extends BroadcastReceiver {
    
    private static final String TAG = "MediaActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        
        Log.d(TAG, "Action received: " + action);
        
        // 通过 MediaSession 处理，会自动回调到 MainActivity
        // 这里不需要额外处理，MediaSession.Callback 已经设置了
    }
}