#!/usr/bin/env node
// moonPlayer 后台管理命令
// 用法: node dist/cli.js [command]
// 命令: clear-admin - 清除管理员密码

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

// 应用数据目录
const appDir = path.join(os.homedir(), '.moonplayer');
const dbPath = path.join(appDir, 'moonplayer.db');

function getDatabase(): Database.Database {
  if (!fs.existsSync(appDir)) {
    fs.mkdirSync(appDir, { recursive: true });
  }
  return new Database(dbPath);
}

function clearAdmin() {
  const db = getDatabase();

  try {
    // 检查是否有管理员
    const admin = db.prepare('SELECT id FROM admin WHERE id = 1').get();

    if (!admin) {
      console.log('❌ 没有设置管理员账户');
      return;
    }

    // 获取播放列表数量等数据统计
    const playlistCount = db.prepare('SELECT COUNT(*) as count FROM playlists').get() as { count: number };
    const trackCount = db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number };

    console.log('⚠️  即将清除管理员密码');
    console.log(`   播放列表数量: ${playlistCount.count}`);
    console.log(`   音轨数量: ${trackCount.count}`);
    console.log('   注意: 播放列表和音轨数据不会被删除');

    // 清除管理员
    db.prepare('DELETE FROM admin WHERE id = 1').run();
    // 清除所有会话
    db.prepare('DELETE FROM sessions').run();

    console.log('✅ 管理员密码已清除');
    console.log('   下次启动服务时需要重新设置管理员账户');

  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'clear-admin':
      clearAdmin();
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log('moonPlayer 后台管理命令');
      console.log('');
      console.log('用法: node dist/cli.js [command]');
      console.log('');
      console.log('命令:');
      console.log('  clear-admin   清除管理员密码（不删除播放列表等数据）');
      console.log('                下次启动时需要重新设置管理员账户');
      console.log('  help          显示此帮助信息');
      break;

    default:
      console.log('未知命令:', command);
      console.log('使用 "node dist/cli.js help" 查看可用命令');
      process.exit(1);
  }
}

main();