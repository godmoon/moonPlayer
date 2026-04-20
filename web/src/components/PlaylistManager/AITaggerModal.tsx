// AI 标签弹窗组件
import { useState } from 'react';
import { getUntaggedCount, getUntaggedTracks, importTags } from '../../stores/api';
import { copyToClipboard } from './utils';

interface AITaggerModalProps {
  onClose: () => void;
}

export function AITaggerModal({ onClose }: AITaggerModalProps) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiImporting, setAiImporting] = useState(false);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [aiResult, setAiResult] = useState<{ updated: number } | null>(null);
  const [batchSize, setBatchSize] = useState(200);

  // 生成 AI 标签提示词
  const handleGeneratePrompt = async () => {
    setAiLoading(true);
    setAiPrompt('');
    try {
      const count = await getUntaggedCount();
      setUntaggedCount(count);
      
      const tracks = await getUntaggedTracks(batchSize, 0);
      
      const trackList = tracks.map((t) => 
        `${t.id}|${t.path}|${t.album || ''}|${t.artist || ''}|${t.year || ''}`
      ).join('\n');

      const prompt = `你是一个音乐播放列表管理助手。用户有以下歌曲库，请发挥你的想象力和创造力，针对每一首歌曲提供的信息，加上你自己的数据库，给他们分配1~30个标签，包括但不限于：儿童，纯音乐，开车，睡眠，休闲，放松等等，你自己发挥。
只返回标注后的数据，不返回其他内容。
请以下面的格式返回播放列表，格式如下:
ID|标签1,标签2,...
以下是歌曲库信息，歌曲信息格式为:"ID|路径|专辑|演唱者|年份"，一行一个：
${trackList}`;

      setAiPrompt(prompt);
    } catch (err) {
      console.error('生成提示词失败:', err);
      alert('生成提示词失败,请检查后端 API');
    } finally {
      setAiLoading(false);
    }
  };

  // 导入 AI 生成的标签
  const handleImportTags = async () => {
    if (!aiInput.trim()) {
      alert('请粘贴 AI 返回的标签数据');
      return;
    }
    setAiImporting(true);
    setAiResult(null);
    try {
      const lines = aiInput.trim().split('\n');
      const tags: Array<{ id: number; tags: string[] }> = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = trimmed.match(/^(\d+)\|(.+)$/);
        if (match) {
          const id = parseInt(match[1], 10);
          const tagStr = match[2];
          const tagList = tagStr.split(',').map(t => t.trim()).filter(t => t);

          if (id && tagList.length > 0) {
            tags.push({ id, tags: tagList.slice(0, 30) });
          }
        }
      }

      if (tags.length === 0) {
        throw new Error('未找到有效的标签数据,请检查格式是否为: ID|标签1,标签2,...');
      }

      const result = await importTags(tags);
      setAiResult(result);
      setAiInput('');
      alert(`成功标注 ${result.updated} 首歌曲`);
    } catch (err: any) {
      console.error('导入标签失败:', err);
      alert('导入失败: ' + (err.message || '格式错误'));
    } finally {
      setAiImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start pt-20 justify-center z-[999]">
      <div className="bg-gray-800 rounded-lg p-4 w-[800px] max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">🏷️ AI 标注歌曲标签</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          {/* 步骤说明 */}
          <div className="text-sm text-gray-400 bg-gray-700/50 p-3 rounded">
            <strong>使用说明:</strong><br/>
            1. 设置每批处理数量，点击「生成提示词」获取未标注的歌曲信息<br/>
            2. 复制提示词发送给 AI(如 ChatGPT)<br/>
            3. 将 AI 返回的标签数据粘贴到下方输入框<br/>
            4. 点击「导入标签」完成标注
            {untaggedCount > 0 && (
              <div className="mt-2 text-yellow-400">
                📊 一共 <strong>{untaggedCount}</strong> 首歌曲未标注标签
              </div>
            )}
          </div>

          {/* 批次大小设置 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">每批数量:</label>
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(1000, Number(e.target.value))))}
              min={1}
              max={1000}
              className="w-24 px-2 py-1 bg-gray-700 rounded text-sm"
            />
            <span className="text-xs text-gray-500">首 (1-1000)</span>
          </div>

          {/* 生成提示词按钮 */}
          <button
            onClick={handleGeneratePrompt}
            disabled={aiLoading}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm"
          >
            {aiLoading ? '生成中...' : '📝 生成提示词'}
          </button>

          {/* 提示词显示区域 */}
          {aiPrompt && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">生成的提示词(复制发送给 AI):</label>
              <textarea
                value={aiPrompt}
                readOnly
                className="w-full h-48 px-3 py-2 bg-gray-700 rounded text-sm font-mono resize-none"
              />
              <button
                onClick={() => { copyToClipboard(aiPrompt); alert('已复制到剪贴板'); }}
                className="mt-2 px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs"
              >
                📋 复制提示词
              </button>
            </div>
          )}

          {/* AI 返回数据输入区域 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">粘贴 AI 返回的标签数据:</label>
            <textarea
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder='每行一首歌曲,格式:ID|标签1,标签2,...'
              className="w-full h-40 px-3 py-2 bg-gray-700 rounded text-sm font-mono resize-none"
            />
          </div>

          {/* 导入按钮 */}
          <button
            onClick={handleImportTags}
            disabled={aiImporting || !aiInput.trim()}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm"
          >
            {aiImporting ? '导入中...' : '✅ 导入标签'}
          </button>

          {/* 导入结果 */}
          {aiResult && (
            <div className="text-sm text-green-400 bg-green-900/30 p-3 rounded">
              ✅ 成功标注 {aiResult.updated} 首歌曲
            </div>
          )}
        </div>
      </div>
    </div>
  );
}