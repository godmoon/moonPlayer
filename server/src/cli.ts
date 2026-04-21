#!/usr/bin/env node
// moonPlayer 后台管理命令
// 用法: node dist/cli.js [command]
// 命令: clear-admin - 清除管理员密码

import { initDatabaseAsync, getDatabase, closeDatabase, clearAdminPassword } from './db/schema.js';

async function clearAdmin() {
  // 初始化数据库
  await initDatabaseAsync();
  const db = getDatabase();

  try {
    // 检查是否有管理员
    const admin = db.prepare('SELECT id FROM admin WHERE id = 1').get();

    if (!admin) {
      console.log('No admin account set');
      return;
    }

    // 获取播放列表数量等数据统计
    const playlistCount = db.prepare('SELECT COUNT(*) as count FROM playlists').get() as { count: number };
    const trackCount = db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number };

    console.log('Warning: About to clear admin password');
    console.log(`   Playlists: ${playlistCount.count}`);
    console.log(`   Tracks: ${trackCount.count}`);
    console.log('   Note: Playlists and tracks will NOT be deleted');

    // 清除管理员
    const result = clearAdminPassword();
    if (result.success) {
      console.log('Admin password cleared');
      console.log('   You will need to set up admin again on next start');
    } else {
      console.log('Failed:', result.error);
    }

  } finally {
    closeDatabase();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'clear-admin':
      await clearAdmin();
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log('moonPlayer Admin CLI');
      console.log('');
      console.log('Usage: node dist/cli.js [command]');
      console.log('');
      console.log('Commands:');
      console.log('  clear-admin   Clear admin password (keep playlists and tracks)');
      console.log('                Need to setup admin again on next start');
      console.log('  help          Show this help');
      break;

    default:
      console.log('Unknown command:', command);
      console.log('Use "node dist/cli.js help" for available commands');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});