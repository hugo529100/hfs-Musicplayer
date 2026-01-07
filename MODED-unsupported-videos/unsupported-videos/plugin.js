exports.version = 3.2;
exports.apiRequired = 12.91;
exports.description = "Optimized media player with intelligent gradient transcoding and high-quality DSD/DSF support";
exports.repo = "Hug3O/Unsupported-videos";
exports.preview = ["https://github.com/user-attachments/assets/7daaf2c8-9dbd-46f1-93b6-7628c4d1d3b6"]
exports.frontend_js = 'main.js';

const CACHE_DIR = 'cache';
const COVERS_DIR = 'covers';
const VIDEO_THUMBNAIL_DIR = 'videothumbnail';
const TEMP_PREFIX = 'tmp_';
const MIN_FILE_SIZE = 1024;
const WAV_MIN_SIZE = 1024 * 1024;
const FLAC_HEADER = Buffer.from('664c6143', 'hex');
const SUPPORTED_AUDIO_EXTS = ['mp3','flac','m4a','ogg','wma','aiff','aif','alac','dsd','dsf','dff','ape','wav'];
const SUPPORTED_VIDEO_EXTS = ['webm','avi','mkv','mp4','mov','mpg','wmv','ts','rmvb','rm','dat','vob','flv'];
const PROCESS_CLEANUP_TIMEOUT = 5000; // Timeout for process cleanup (5 seconds)

// 重新整理的配置面板 - 重要設置項目靠前
exports.config = {
  // ================ 1. 基本設置 ================
  extensions: {
    frontend: true,
    defaultValue: 'webm,avi,mkv,mp4,mov,mpg,rmvb,rm,dat,ts,vob,aiff,aif,alac,dsd,dsf,dff,ape,mp3,flac,m4a,ogg,wma,wmv',
    helperText: "Supported file extensions",
    xs: 12
  },
  ffmpeg_path: {
    type: 'real_path',
    fileMask: 'ffmpeg*',
    defaultValue: '',
    helperText: "Path to FFmpeg executable. Leave empty if it's in the system path.",
    xs: 6
  },
  ffmpeg_parameters: {
    defaultValue: '',
    helperText: "Additional parameters to pass to FFmpeg (supports quotes)",
    xs: 6
  },
  
  // ================ 2. 性能與進程管理 ================
  max_processes: { 
    type: 'number', 
    min: 1, 
    max: 50, 
    defaultValue: 3, 
    xs: 6,
    label: "Max concurrent processes",
    helperText: "Maximum number of concurrent FFmpeg processes"
  },
  allowAnonymous: { 
    type: 'boolean', 
    defaultValue: true, 
    xs: 6,
    label: "Allow anonymous access",
    helperText: "Allow users without account to access media"
  },
  max_processes_per_account: {
    showIf: x => !x.allowAnonymous,
    type: 'number', 
    min: 1, 
    max: 50, 
    defaultValue: 1, 
    xs: 6,
    label: "Max processes per account",
    helperText: "Maximum processes per user account"
  },
  accounts: {
    showIf: x => !x.allowAnonymous,
    type: 'username', 
    multiple: true,
    label: "Allowed accounts",
    helperText: "Leave empty to allow every account",
    xs: 12
  },
  
  // ================ 3. 音頻相關設置 ================
  audio_format: {
    type: 'select',
    label: 'Audio output format',
    defaultValue: 'wav',
    options: { 
      FLAC: 'flac', 
      WAV: 'wav' 
    },
    xs: 6
  },
  enable_lossless_cache: {
    type: 'boolean',
    defaultValue: true,
    label: 'Enable lossless audio cache',
    showIf: x => x.audio_format === 'flac' || x.audio_format === 'wav',
    helperText: 'Cache decoded lossless audio files for faster playback',
    xs: 6
  },
  dsd_conversion_mode: {
    type: 'select',
    label: 'DSD Conversion Quality',
    defaultValue: 'ultra',
    options: {
      'Standard Quality': 'standard',
      'High Quality': 'high',
      'Ultra Quality': 'ultra'
    },
    helperText: 'Quality setting for DSD to PCM conversion',
    showIf: x => x.extensions.includes('dsd') || x.extensions.includes('dsf'),
    xs: 6
  },
    extract_covers: {
    type: 'boolean',
    defaultValue: false,
    label: 'Extract album covers',
    helperText: 'Extract embedded album covers from audio files',
    xs: 6
  },
  // ================ 4. 視頻轉碼設置 ================
  force_transcode_formats: {
    type: 'string',
    defaultValue: 'wmv,mpg,avi,ts,rmvb,vob,flv',
    helperText: 'File formats that should always be transcoded (comma separated)',
    xs: 12
  },  
transcode_quality: {
    type: 'select',
    label: 'Transcoding Quality',
    defaultValue: 'balanced',
    options: {
      'Fast Preview (Low Quality)': 'fast',
      'Balanced (Recommended)': 'balanced',
      'High Quality': 'high'
    },
    helperText: 'Select transcoding quality to balance loading speed and video quality',
    xs: 6
  },
  enable_hwaccel: {
    type: 'boolean',
    xs: 6,
    defaultValue: false,
    label: 'Enable hardware acceleration',
    helperText: 'Use hardware acceleration for video transcoding if available'
  },

  
  // ================ 5. 封面和縮略圖設置 ================

  extract_video_thumbnails: {
    type: 'boolean',
    defaultValue: false,
    label: 'Extract video thumbnails',
    helperText: 'Extract thumbnails from video files',
    showIf: x => x.extract_covers,
    xs: 6
  },
  thumbnail_format: {
    type: 'select',
    label: 'Thumbnail format',
    defaultValue: 'jpg',
    options: {
      'JPG (Static)': 'jpg',
      'GIF (Animated preview)': 'gif'
    },
    showIf: x => x.extract_video_thumbnails,
    xs: 6
  },
  
  // ================ 6. 智能梯度設置 ================
  video_size_threshold: {
    type: 'number',
    defaultValue: 250,
    min: 1,
    max: 100000,
    label: 'Video size threshold (MB)',
    helperText: 'Videos larger than this will use long video settings',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  
  // ================ 7. GIF通用寬度設置 ================
  gif_width: {
    type: 'number',
    min: 100,
    max: 800,
    defaultValue: 320,
    label: 'GIF width (pixels)',
    helperText: 'Width of output GIF (height auto-scaled)',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  
  // ================ 8. 短視頻GIF設置 (<= threshold) ================
  short_video_start_time: {
    type: 'string',
    defaultValue: '00:03:00',
    label: 'Short video start time (HH:MM:SS)',
    helperText: 'Start time for short videos (<= threshold)',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 12
  },
  short_video_duration: {
    type: 'number',
    min: 1,
    max: 60,
    defaultValue: 10,
    label: 'Short video GIF duration (seconds)',
    helperText: 'Duration of GIF for short videos',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  short_video_fps: {
    type: 'number',
    min: 1,
    max: 30,
    defaultValue: 5,
    label: 'Short video GIF FPS',
    helperText: 'Frames per second for short videos',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  
  // ================ 9. 長視頻GIF設置 (> threshold) ================
  long_video_start_time: {
    type: 'string',
    defaultValue: '00:10:00',
    label: 'Long video start time (HH:MM:SS)',
    helperText: 'Start time for long videos (> threshold)',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 12
  },
  long_video_duration: {
    type: 'number',
    min: 1,
    max: 60,
    defaultValue: 12,
    label: 'Long video GIF duration (seconds)',
    helperText: 'Duration of GIF for long videos',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  long_video_fps: {
    type: 'number',
    min: 1,
    max: 30,
    defaultValue: 6,
    label: 'Long video GIF FPS',
    helperText: 'Frames per second for long videos',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  
  // ================ 10. 候補視頻GIF設置 (Fallback) ================
  backup_video_start_time: {
    type: 'string',
    defaultValue: '00:00:00',
    label: 'Backup video start time (HH:MM:SS)',
    helperText: 'Fallback start time when other settings fail',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 12
  },
  backup_video_duration: {
    type: 'number',
    min: 1,
    max: 60,
    defaultValue: 6,
    label: 'Backup video GIF duration (seconds)',
    helperText: 'Duration of GIF for backup mode',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  backup_video_fps: {
    type: 'number',
    min: 1,
    max: 30,
    defaultValue: 5,
    label: 'Backup video GIF FPS',
    helperText: 'Frames per second for backup mode',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'gif',
    xs: 6
  },
  
  // ================ 11. JPG縮略圖設置 ================
  thumbnail_time: {
    type: 'string',
    defaultValue: '00:00:05',
    label: 'JPG thumbnail time position',
    helperText: 'Time position for JPG thumbnail extraction (HH:MM:SS)',
    showIf: x => x.extract_video_thumbnails && x.thumbnail_format === 'jpg',
    xs: 6
  },
  
  // ================ 12. 調試設置 ================
  debug_ffmpeg: {
    type: 'boolean',
    xs: 6,
    defaultValue: false,
    label: 'Debug FFmpeg',
    helperText: 'Enable FFmpeg debug logging'
  }
};

exports.configDialog = { maxWidth: '55em' };

exports.changelog = [
  { "version": 1.9, "message": "Added video time settings and reorganized configuration panel" },
  { "version": 1.8, "message": "Support quoting in the parameters configuration" },
  { "version": 1.7, "message": "Optimized DSD/DSF support with ultra quality mode" },
  { "version": 1.6, "message": "Added video thumbnail extraction and improved caching" },
  { "version": 1.5, "message": "Enhanced audio processing and DSD conversion" },
  { "version": 1.4, "message": "Added audio format selection and lossless cache" },
  { "version": 1.3, "message": "Improved process management and error handling" },
  { "version": 1.2, "message": "Added hardware acceleration support" },
  { "version": 1.1, "message": "Extended format support and optimized transcoding" },
  { "version": 1.0, "message": "Initial optimized media player release" }
];

exports.init = api => {
  const running = new Map(); // Maps process to { username, pid, startTime }
  const thumbnailProcesses = new Map(); // Maps process to { filePath, pid, startTime, gradientStep }
  const { spawn } = api.require('child_process');
  const fs = api.require('fs');
  const fsp = fs.promises;
  const pathLib = api.require('path');
  const os = api.require('os');

  function parseTimeToSeconds(timeStr) {
    if (!timeStr.includes(':')) {
      return parseFloat(timeStr) || 0;
    }
    
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  function formatTimeFromSeconds(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function getGradientParams() {
    const gifWidth = api.getConfig('gif_width') || 320;
    
    // 轉碼參數根據轉碼質量決定
    const transcodeQuality = api.getConfig('transcode_quality') || 'balanced';
    let transcodeParams;
    
    switch(transcodeQuality) {
      case 'fast':
        transcodeParams = { crf: 28, preset: 'ultrafast', tune: 'fastdecode' };
        break;
      case 'high':
        transcodeParams = { crf: 18, preset: 'medium', tune: 'film' };
        break;
      default: // balanced
        transcodeParams = { crf: 23, preset: 'fast', tune: 'film' };
    }
    
    return {
      SHORT: {
        startTime: parseTimeToSeconds(api.getConfig('short_video_start_time') || '00:01:00'),
        duration: api.getConfig('short_video_duration') || 15,
        fps: api.getConfig('short_video_fps') || 5,
        width: gifWidth,
        transcode: transcodeParams
      },
      LONG: {
        startTime: parseTimeToSeconds(api.getConfig('long_video_start_time') || '00:03:00'),
        duration: api.getConfig('long_video_duration') || 12,
        fps: api.getConfig('long_video_fps') || 6,
        width: gifWidth,
        transcode: transcodeParams
      },
      BACKUP: {
        startTime: parseTimeToSeconds(api.getConfig('backup_video_start_time') || '00:00:00'),
        duration: api.getConfig('backup_video_duration') || 10,
        fps: api.getConfig('backup_video_fps') || 5,
        width: gifWidth,
        transcode: { crf: 26, preset: 'ultrafast', tune: 'fastdecode' } // 候補使用更快參數
      }
    };
  }

  async function validateAudioFile(filePath, format) {
    try {
      const stats = await fsp.stat(filePath);
      if (stats.size < MIN_FILE_SIZE) return false;
      
      if (format === 'wav') {
        return stats.size >= WAV_MIN_SIZE;
      } else if (format === 'flac') {
        const fd = await fsp.open(filePath, 'r');
        const buf = Buffer.alloc(4);
        await fd.read(buf, 0, 4, 0);
        await fd.close();
        return buf.equals(FLAC_HEADER);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function cleanupTempFiles(dir) {
    try {
      const files = await fsp.readdir(dir);
      await Promise.all(files.map(async file => {
        if (file.startsWith(TEMP_PREFIX)) {
          try {
            await fsp.unlink(pathLib.join(dir, file));
            debugLog(`Cleaned temp file: ${file}`);
          } catch (e) {
            debugLog(`Failed to clean temp file ${file}: ${e}`);
          }
        }
      }));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        debugLog(`Temp file cleanup failed: ${e}`);
      }
    }
  }

  async function cleanupZeroByteGifs(dir) {
    try {
      const files = await fsp.readdir(dir);
      await Promise.all(files.map(async file => {
        if (file.toLowerCase().endsWith('.gif')) {
          try {
            const filePath = pathLib.join(dir, file);
            const stats = await fsp.stat(filePath);
            if (stats.size === 0) {
              await fsp.unlink(filePath);
              debugLog(`Cleaned 0-byte GIF: ${file}`);
            }
          } catch (e) {
            // 忽略錯誤
          }
        }
      }));
    } catch (e) {
      // 目錄不存在，忽略
    }
  }

  function debugLog(message) {
    if (api.getConfig('debug_ffmpeg')) {
      api.log(`[DEBUG] ${message}`);
    }
  }

  function cleanupProcess(proc, force = false) {
    try {
      // Skip if already killed
      if (proc.killed) return;
      
      // First try to gracefully kill the process
      proc.kill('SIGTERM');
      
      // Set up a timeout for force kill if process doesn't exit
      const timeout = setTimeout(() => {
        if (proc && !proc.killed) {
          try {
            proc.kill('SIGKILL');
            debugLog(`Force killed PID ${proc.pid}`);
          } catch (e) {
            debugLog(`SIGKILL failed for PID ${proc.pid}: ${e}`);
          }
        }
      }, force ? 0 : PROCESS_CLEANUP_TIMEOUT);
      
      // Clean up streams
      if (proc.stdout) proc.stdout.destroy();
      if (proc.stderr) proc.stderr.destroy();
      if (proc.stdin) proc.stdin.destroy();
      
      // Clear the timeout if process exits
      proc.once('exit', () => clearTimeout(timeout));
    } catch (e) {
      debugLog(`Cleanup process error: ${e}`);
    }
  }

  async function getVideoParams(filePath, fileSizeMB) {
    // 獲取梯度參數
    const gradientParams = getGradientParams();
    const threshold = api.getConfig('video_size_threshold') || 250;
    const isLongVideo = fileSizeMB > threshold;
    
    const params = isLongVideo ? gradientParams.LONG : gradientParams.SHORT;
    
    debugLog(`視頻文件: ${pathLib.basename(filePath)} (大小: ${fileSizeMB.toFixed(2)}MB, 閾值: ${threshold}MB, 類型: ${isLongVideo ? '長視頻' : '短視頻'})`);
    
    return {
      thumbnail: params,
      transcode: params.transcode,
      isLongVideo: isLongVideo
    };
  }

  async function extractAlbumCover(filePath) {
    if (!api.getConfig('extract_covers')) return;
    
    const ext = pathLib.extname(filePath).toLowerCase().slice(1);
    if (!SUPPORTED_AUDIO_EXTS.includes(ext)) return;

    try {
      const dir = pathLib.dirname(filePath);
      const coversDir = pathLib.join(dir, CACHE_DIR, COVERS_DIR);
      await fsp.mkdir(coversDir, { recursive: true });
      
      const filename = pathLib.basename(filePath, pathLib.extname(filePath));
      const coverPath = pathLib.join(coversDir, `${filename}.jpg`);
      
      try {
        await fsp.access(coverPath);
        return;
      } catch {}

      const ffmpeg = spawn(api.getConfig('ffmpeg_path') || 'ffmpeg', [
        '-i', filePath,
        '-an',
        '-vcodec', 'copy',
        coverPath
      ]);

      return new Promise(resolve => {
        ffmpeg.on('exit', code => {
          cleanupProcess(ffmpeg);
          if (code !== 0) {
            fsp.unlink(coverPath).catch(() => {});
            debugLog(`Album cover extraction failed with code ${code} for ${filePath}`);
          }
          resolve();
        });
        ffmpeg.on('error', (err) => {
          cleanupProcess(ffmpeg);
          debugLog(`Album cover extraction error for ${filePath}: ${err}`);
          resolve();
        });
      });
    } catch (e) {
      debugLog(`Album cover extraction failed ${filePath}: ${e}`);
    }
  }

  async function generateGifWithParams(filePath, thumbnailPath, params) {
    const startTime = params.startTime;
    const duration = params.duration;
    const fps = params.fps;
    const width = params.width;
    
    debugLog(`GIF生成參數: ${pathLib.basename(filePath)} (起始: ${startTime}秒, 時長: ${duration}秒, ${fps}幀, 寬度: ${width}像素)`);
    
    const palettePath = thumbnailPath.replace('.gif', '_palette.png');
    
    // 第一梯度：生成調色板
    const paletteArgs = [
      '-ss', formatTimeFromSeconds(startTime),
      '-t', '5',
      '-i', filePath,
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`,
      '-y', palettePath
    ];
    
    const paletteProc = spawn(api.getConfig('ffmpeg_path') || 'ffmpeg', paletteArgs);
    
    await new Promise(resolve => {
      paletteProc.on('exit', code => {
        cleanupProcess(paletteProc);
        if (code !== 0) {
          debugLog(`調色板生成失敗: ${filePath} (代碼: ${code})`);
          fsp.unlink(palettePath).catch(() => {});
        }
        resolve();
      });
      paletteProc.on('error', (err) => {
        cleanupProcess(paletteProc);
        debugLog(`調色板生成錯誤: ${filePath} - ${err}`);
        resolve();
      });
    });
    
    // 第二梯度：生成GIF
    const gifArgs = [
      '-ss', formatTimeFromSeconds(startTime),
      '-t', duration.toString(),
      '-i', filePath,
      '-i', palettePath,
      '-filter_complex', `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', '0',
      '-f', 'gif',
      '-y', thumbnailPath
    ];
    
    const gifProc = spawn(api.getConfig('ffmpeg_path') || 'ffmpeg', gifArgs);
    
    return new Promise(resolve => {
      gifProc.on('exit', async code => {
        cleanupProcess(gifProc);
        try { await fsp.unlink(palettePath); } catch {}
        
        if (code === 0) {
          // 檢查生成的GIF是否有效
          try {
            const stats = await fsp.stat(thumbnailPath);
            if (stats.size > 0) {
              resolve(true);
            } else {
              debugLog(`生成的GIF為0字節: ${filePath}`);
              try { await fsp.unlink(thumbnailPath); } catch {}
              resolve(false);
            }
          } catch {
            debugLog(`無法讀取生成的GIF: ${filePath}`);
            resolve(false);
          }
        } else {
          debugLog(`GIF生成失敗: ${filePath} (代碼: ${code})`);
          try { await fsp.unlink(thumbnailPath); } catch {}
          resolve(false);
        }
      });
      gifProc.on('error', async (err) => {
        cleanupProcess(gifProc);
        try { await fsp.unlink(palettePath); } catch {}
        try { await fsp.unlink(thumbnailPath); } catch {}
        debugLog(`GIF生成錯誤: ${filePath} - ${err}`);
        resolve(false);
      });
    });
  }

  async function extractVideoThumbnail(filePath) {
    const ext = pathLib.extname(filePath).toLowerCase().slice(1);
    if (!SUPPORTED_VIDEO_EXTS.includes(ext)) return;

    try {
      const dir = pathLib.dirname(filePath);
      const thumbnailsDir = pathLib.join(dir, CACHE_DIR, VIDEO_THUMBNAIL_DIR);
      await fsp.mkdir(thumbnailsDir, { recursive: true });
      
      // 清理0字節GIF文件
      await cleanupZeroByteGifs(thumbnailsDir);
      
      const filename = pathLib.basename(filePath, pathLib.extname(filePath));
      const format = api.getConfig('thumbnail_format') || 'jpg';
      const thumbnailPath = pathLib.join(thumbnailsDir, `${filename}.${format}`);
      
      try {
        await fsp.access(thumbnailPath);
        return;
      } catch {}

      // 檢查是否為0字節視頻文件
      try {
        const stats = await fsp.stat(filePath);
        if (stats.size === 0) {
          debugLog(`跳過0字節視頻文件: ${filePath}`);
          return;
        }
      } catch (e) {
        debugLog(`無法讀取文件信息: ${filePath} - ${e}`);
        return;
      }

      if (format === 'jpg') {
        let time = api.getConfig('thumbnail_time') || '00:00:05';
        if (!time.includes(':')) {
          const seconds = parseInt(time) || 5;
          time = formatTimeFromSeconds(seconds);
        }

        const ffmpeg = spawn(api.getConfig('ffmpeg_path') || 'ffmpeg', [
          '-ss', time,
          '-i', filePath,
          '-vframes', '1',
          '-q:v', '2',
          '-f', 'image2',
          thumbnailPath
        ]);

        return new Promise(resolve => {
          ffmpeg.on('exit', code => {
            cleanupProcess(ffmpeg);
            if (code !== 0) {
              fsp.unlink(thumbnailPath).catch(() => {});
              debugLog(`JPG縮略圖生成失敗: ${filePath} (代碼: ${code})`);
            }
            resolve();
          });
          ffmpeg.on('error', (err) => {
            cleanupProcess(ffmpeg);
            debugLog(`JPG縮略圖生成錯誤: ${filePath} - ${err}`);
            resolve();
          });
        });
      } else {
        // GIF格式 - 使用智能梯度生成
        try {
          const stats = await fsp.stat(filePath);
          const fileSizeMB = stats.size / (1024 * 1024);
          
          // 獲取所有參數設置
          const gradientParams = getGradientParams();
          
          // 判斷視頻類型
          const threshold = api.getConfig('video_size_threshold') || 250;
          const isLongVideo = fileSizeMB > threshold;
          
          debugLog(`視頻文件: ${pathLib.basename(filePath)} (大小: ${fileSizeMB.toFixed(2)}MB, 閾值: ${threshold}MB, 類型: ${isLongVideo ? '長視頻' : '短視頻'})`);
          
          let success = false;
          
          if (isLongVideo) {
            // 1. 首先嘗試長視頻GIF設置
            debugLog(`嘗試長視頻GIF設置...`);
            success = await generateGifWithParams(filePath, thumbnailPath, gradientParams.LONG);
            
            if (!success) {
              // 2. 長視頻GIF設置失敗，嘗試短視頻GIF設置
              debugLog(`長視頻GIF設置失敗，嘗試短視頻GIF設置...`);
              success = await generateGifWithParams(filePath, thumbnailPath, gradientParams.SHORT);
            }
          } else {
            // 1. 首先嘗試短視頻GIF設置
            debugLog(`嘗試短視頻GIF設置...`);
            success = await generateGifWithParams(filePath, thumbnailPath, gradientParams.SHORT);
          }
          
          if (!success) {
            // 3. 短視頻GIF設置失敗，嘗試候補視頻GIF設置
            debugLog(`短視頻GIF設置失敗，嘗試候補視頻GIF設置...`);
            success = await generateGifWithParams(filePath, thumbnailPath, gradientParams.BACKUP);
          }
          
          if (success) {
            debugLog(`GIF生成成功: ${thumbnailPath}`);
          } else {
            debugLog(`所有梯度嘗試均失敗: ${filePath}`);
            try { await fsp.unlink(thumbnailPath); } catch {}
          }
        } catch (e) {
          debugLog(`GIF生成過程錯誤: ${filePath} - ${e}`);
        }
      }
    } catch (e) {
      debugLog(`視頻縮略圖提取失敗: ${filePath} - ${e}`);
    }
  }

  function extractVideoThumbnailAsync(filePath) {
    if (!api.getConfig('extract_video_thumbnails')) return Promise.resolve();

    return new Promise(resolve => {
      setImmediate(async () => {
        try {
          await extractVideoThumbnail(filePath);
        } catch (e) {
          debugLog(`異步縮略圖提取失敗: ${e}`);
        } finally {
          resolve();
        }
      });
    });
  }

  return {
    unload() {
      for (const proc of running.keys()) cleanupProcess(proc, true);
      for (const proc of thumbnailProcesses.keys()) cleanupProcess(proc, true);
    },
    middleware: async ctx => {
      return async () => {
        const src = ctx.state.fileSource;
        if (!src) return;

        const ext = pathLib.extname(src).toLowerCase().slice(1);
        
        // 始終啟用異步處理
        if (SUPPORTED_AUDIO_EXTS.includes(ext)) {
          extractAlbumCover(src).catch(e => debugLog(`異步專輯封面提取錯誤: ${e}`));
        } 
        else if (SUPPORTED_VIDEO_EXTS.includes(ext)) {
          extractVideoThumbnailAsync(src);
        }

        const forceTranscodeFormats = (api.getConfig('force_transcode_formats') || 'wmv,mpg,avi,ts,rmvb,vob,flv')
          .toLowerCase()
          .split(',')
          .map(x => x.trim());
        
        const shouldForceTranscode = forceTranscodeFormats.includes(ext);
        
        if (ctx.querystring !== 'ffmpeg' && !shouldForceTranscode) return;

        if (ext === 'mp3') return;

        const accounts = api.getConfig('accounts');
        const username = api.getCurrentUsername(ctx);
        if (!api.getConfig('allowAnonymous')) {
          if (!username || (accounts?.length && !api.ctxBelongsTo(ctx, accounts))) {
            return ctx.status = api.Const.HTTP_UNAUTHORIZED;
          }
        }

        // 等待500ms以避免短暫請求
        await new Promise(res => setTimeout(res, 500));
        if (ctx.socket.closed) return;

        const max = api.getConfig('max_processes');
        const maxA = !api.getConfig('allowAnonymous') && api.getConfig('max_processes_per_account');
        const waitLimit = 10;
        let waited = 0;

        function countUsername() {
          let ret = 0;
          for (const x of running.values()) {
            if (x.username === username) ret++;
          }
          return ret;
        }

        while (running.size >= max || (maxA && countUsername() >= maxA)) {
          if (++waited > waitLimit) return ctx.status = api.Const.HTTP_TOO_MANY_REQUESTS;
          await new Promise(res => setTimeout(res, 1000));
          if (ctx.socket.closed) return;
        }

        const isAudio = SUPPORTED_AUDIO_EXTS.includes(ext);
        const outFormat = api.getConfig('audio_format') || 'flac';
        const transcodeQuality = api.getConfig('transcode_quality') || 'balanced';
        const dsdConversionMode = api.getConfig('dsd_conversion_mode') || 'high';

        // 解析額外的 FFmpeg 參數，支援引號
        const additionalParams = api.getConfig('ffmpeg_parameters') || '';
        const parsedAdditionalParams = additionalParams.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(s => s.replace(/^['"]|['"]$/g, '')) || [];

        const ffmpegArgs = [];
        if (api.getConfig('enable_hwaccel') && !isAudio) {
          ffmpegArgs.push('-hwaccel', 'auto');
        }
        ffmpegArgs.push('-i', src);

        if (isAudio) {
          if (['dsf', 'dff', 'dsd'].includes(ext)) {
            // DSD專用轉換參數
            const dsdParams = {
              standard: {
                sampleRate: '44100',
                precision: '24',
                filter: 'aresample=resampler=soxr:precision=24:osr=44100'
              },
              high: {
                sampleRate: '88200',
                precision: '28',
                filter: 'aresample=resampler=soxr:precision=28:osr=88200'
              },
              ultra: {
                sampleRate: '176400',
                precision: '33',
                filter: 'aresample=resampler=soxr:precision=33:osr=176400'
              }
            };
            
            const { sampleRate, precision, filter } = dsdParams[dsdConversionMode] || dsdParams.high;

            ffmpegArgs.push(
              '-c:a', outFormat === 'wav' ? 'pcm_s24le' : 'flac',
              '-ar', sampleRate,
              '-sample_fmt', outFormat === 'wav' ? 's32' : 's16',
              '-filter_complex', filter,
              ...(outFormat === 'wav' ? [
                '-fflags', '+bitexact',
                '-write_xing', '0'
              ] : []),
              ...(outFormat === 'flac' ? [
                '-compression_level', '5',
                '-lpc_type', 'cholesky'
              ] : []),
              ...parsedAdditionalParams,
              '-f', outFormat,
              'pipe:1'
            );
          }
          else if (['aiff', 'aif'].includes(ext)) {
            ffmpegArgs.push(
              '-c:a', outFormat === 'wav' ? 'pcm_s24le' : 'flac',
              '-ar', '0',
              '-sample_fmt', outFormat === 'wav' ? 's32' : 's16',
              ...(outFormat === 'wav' ? [
                '-fflags', '+bitexact',
                '-write_xing', '0'
              ] : []),
              ...(outFormat === 'flac' ? [
                '-compression_level', '5',
                '-lpc_type', 'cholesky'
              ] : []),
              ...parsedAdditionalParams,
              '-f', outFormat,
              'pipe:1'
            );
          }
          else {
            ffmpegArgs.push(
              '-c:a', outFormat === 'wav' ? 'pcm_s16le' : 'flac',
              '-ar', '48000',
              ...(outFormat === 'wav' ? [
                '-fflags', '+bitexact',
                '-write_xing', '0'
              ] : []),
              ...(outFormat === 'flac' ? [
                '-compression_level', '5',
                '-lpc_type', 'cholesky'
              ] : []),
              ...parsedAdditionalParams,
              '-f', outFormat,
              'pipe:1'
            );
          }
        } else {
          // 視頻轉碼 - 使用智能梯度參數
          let transcodeParams;
          try {
            const stats = await fsp.stat(src);
            const fileSizeMB = stats.size / (1024 * 1024);
            const videoParams = await getVideoParams(src, fileSizeMB);
            transcodeParams = videoParams.transcode;
          } catch {
            // 如果獲取參數失敗，使用默認質量
            const defaultTranscodeParams = {
              crf: 23,
              preset: 'fast',
              tune: 'film'
            };
            transcodeParams = defaultTranscodeParams;
          }

          // 根據轉碼質量調整參數
          let qualityArgs = [];
          switch (transcodeQuality) {
            case 'fast':
              qualityArgs = [
                '-crf', '28',
                '-preset', 'ultrafast',
                '-tune', 'fastdecode',
                '-threads', '2'
              ];
              break;
            case 'balanced':
              qualityArgs = [
                '-crf', transcodeParams.crf || '23',
                '-preset', transcodeParams.preset || 'fast',
                '-tune', transcodeParams.tune || 'film'
              ];
              break;
            case 'high':
              qualityArgs = [
                '-crf', '18',
                '-preset', 'medium',
                '-tune', 'film'
              ];
              break;
            default:
              qualityArgs = [
                '-crf', transcodeParams.crf || '23',
                '-preset', transcodeParams.preset || 'fast',
                '-tune', transcodeParams.tune || 'film'
              ];
          }

          ffmpegArgs.push(
            '-f', 'mp4',
            '-movflags', 'frag_keyframe+empty_moov+faststart',
            '-vcodec', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-acodec', 'aac',
            '-strict', '-2',
            ...qualityArgs,
            '-frag_duration', '10000',
            '-frag_size', '256',
            '-min_frag_duration', '5000',
            '-movflags', 'frag_custom',
            '-flush_packets', '1',
            '-max_muxing_queue_size', '256',
            ...parsedAdditionalParams,
            'pipe:1'
          );
        }

        const proc = spawn(api.getConfig('ffmpeg_path') || 'ffmpeg', ffmpegArgs);
        running.set(proc, {
          username,
          pid: proc.pid,
          startTime: Date.now()
        });
        
        let confirmed = false;
        proc.on('spawn', () => {
          confirmed = true;
          debugLog(`啟動FFmpeg進程 (PID: ${proc.pid}) 處理: ${pathLib.basename(src)}`);
          if (['dsf', 'dff', 'dsd'].includes(ext)) {
            debugLog(`DSD轉換模式: ${dsdConversionMode}`);
          }
        });
        
        proc.on('error', (err) => {
          if (!confirmed) running.delete(proc);
          cleanupProcess(proc);
          debugLog(`FFmpeg進程錯誤: ${src} - ${err}`);
        });
        
        proc.on('exit', (code) => {
          running.delete(proc);
          cleanupProcess(proc);
          debugLog(`FFmpeg進程結束 (PID: ${proc.pid}) 代碼: ${code} - ${pathLib.basename(src)}`);
        });

        if (api.getConfig('debug_ffmpeg')) {
          proc.stderr.on('data', x => debugLog(`FFmpeg輸出: ${String(x)}`));
        }

        ctx.type = isAudio ? `audio/${outFormat}` : 'video/mp4';
        ctx.body = proc.stdout;
        ctx.req.on('end', () => cleanupProcess(proc));
        ctx.status = 200;

        if (isAudio && api.getConfig('enable_lossless_cache') && (outFormat === 'flac' || outFormat === 'wav')) {
          try {
            const cacheExt = outFormat === 'wav' ? 'wav' : 'flac';
            const cacheDir = pathLib.join(pathLib.dirname(src), CACHE_DIR);
            const finalFile = pathLib.join(cacheDir, pathLib.basename(src, pathLib.extname(src)) + '.' + cacheExt);
            
            await fsp.mkdir(cacheDir, { recursive: true });
            await cleanupTempFiles(cacheDir);
            
            const tempFile = pathLib.join(cacheDir, TEMP_PREFIX + pathLib.basename(src, pathLib.extname(src)) + '.' + cacheExt);
            
            try { await fsp.unlink(tempFile); } catch {}

            const cacheArgs = ['-i', src];
            if (['dsf', 'dff', 'dsd'].includes(ext)) {
              const dsdParams = {
                standard: {
                  sampleRate: '44100',
                  precision: '24',
                  filter: 'aresample=resampler=soxr:precision=24:osr=44100'
                },
                high: {
                  sampleRate: '88200',
                  precision: '28',
                  filter: 'aresample=resampler=soxr:precision=28:osr=88200'
                },
                ultra: {
                  sampleRate: '176400',
                  precision: '33',
                  filter: 'aresample=resampler=soxr:precision=33:osr=176400'
                }
              };
              
              const { sampleRate, precision, filter } = dsdParams[dsdConversionMode] || dsdParams.high;

              cacheArgs.push(
                '-c:a', outFormat === 'wav' ? 'pcm_s24le' : 'flac',
                '-ar', sampleRate,
                '-sample_fmt', outFormat === 'wav' ? 's32' : 's16',
                '-filter_complex', filter,
                ...(outFormat === 'wav' ? [
                  '-fflags', '+bitexact',
                  '-write_xing', '0'
                ] : []),
                ...(outFormat === 'flac' ? [
                  '-compression_level', '5',
                  '-lpc_type', 'cholesky'
                ] : []),
                ...parsedAdditionalParams,
                '-f', outFormat,
                tempFile
              );
            }
            else if (['aiff', 'aif'].includes(ext)) {
              cacheArgs.push(
                '-c:a', outFormat === 'wav' ? 'pcm_s24le' : 'flac',
                '-ar', '0',
                '-sample_fmt', outFormat === 'wav' ? 's32' : 's16',
                ...(outFormat === 'wav' ? [
                  '-fflags', '+bitexact',
                  '-write_xing', '0'
                ] : []),
                ...(outFormat === 'flac' ? [
                  '-compression_level', '5',
                  '-lpc_type', 'cholesky'
                ] : []),
                ...parsedAdditionalParams,
                '-f', outFormat,
                tempFile
              );
            }
            else {
              cacheArgs.push(
                '-c:a', outFormat === 'wav' ? 'pcm_s16le' : 'flac',
                '-ar', '48000',
                ...(outFormat === 'wav' ? [
                  '-fflags', '+bitexact',
                  '-write_xing', '0'
                ] : []),
                ...(outFormat === 'flac' ? [
                  '-compression_level', '5',
                  '-lpc_type', 'cholesky'
                ] : []),
                ...parsedAdditionalParams,
                '-f', outFormat,
                tempFile
              );
            }

            const cacheProc = spawn(api.getConfig('ffmpeg_path') || 'ffmpeg', cacheArgs);

            cacheProc.on('exit', async (code) => {
              cleanupProcess(cacheProc);
              const isAcceptableError = 
                (outFormat === 'wav' && code === 255) || 
                (outFormat === 'flac' && code === 1);

              if (code === 0 || isAcceptableError) {
                const isValid = await validateAudioFile(tempFile, outFormat);
                if (isValid) {
                  await fsp.rename(tempFile, finalFile);
                  debugLog(`緩存保存${isAcceptableError ? ' (使用錯誤解決方案)' : ''}: ${finalFile}`);
                } else {
                  debugLog(`緩存驗證失敗，刪除: ${tempFile}`);
                  await fsp.unlink(tempFile);
                }
              } else {
                debugLog(`緩存生成失敗，代碼 ${code}`);
                try { await fsp.unlink(tempFile); } catch {}
              }
            });

            cacheProc.on('error', e => {
              cleanupProcess(cacheProc);
              debugLog('緩存進程錯誤: ' + e);
              fsp.unlink(tempFile).catch(() => {});
            });

          } catch (e) {
            debugLog('緩存設置失敗: ' + e);
          }
        }
      };
    }
  };
};