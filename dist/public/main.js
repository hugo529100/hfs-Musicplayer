const { h, t } = HFS
const cfg = HFS.getPluginConfig()

// 随机播放状态存储键名
const SHUFFLE_STORAGE_KEY = 'mmp_shuffle_enabled'

// 检查 localStorage 是否支持
const isLocalStorageSupported = () => {
  try {
    localStorage.setItem('test', '1');
    localStorage.removeItem('test');
    return true;
  } catch (e) {
    return false;
  }
};

// 获取随机播放状态
const getShuffleState = () => {
  if (!isLocalStorageSupported()) return true;
  const val = localStorage.getItem(SHUFFLE_STORAGE_KEY);
  return val === null ? true : val === 'true';
};

// 保存随机播放状态
const setShuffleState = (value) => {
  if (isLocalStorageSupported()) {
    localStorage.setItem(SHUFFLE_STORAGE_KEY, value ? 'true' : 'false');
  }
};

const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream
const unsupportedPlugin = HFS.plugins['unsupported-videos'] || HFS.plugins['unsupported-videos']

// ========== fileMenu 事件处理 - 同时支持文件和文件夹 ==========
if (cfg.use_file_menu) {
    HFS.onEvent('fileMenu', ({ entry }) => {
        if (entry.isFolder) {
            return {
                id: 'mmp-play-folder',
                icon: 'play',
                label: t`Play with Musicplayer+`,
                onClick: () => MMP.playFolder(entry)
            }
        }
        if (MMP.audio_formats.test(entry.uri)) {
            return {
                id: 'mmp-play-file',
                icon: 'play',
                label: t`Play audio`,
                onClick: () => MMP.audio(entry)
            }
        }
        return null
    })
}

// fileList 事件处理
if (cfg.use_file_list) {
    HFS.onEvent('afterEntryName', ({ entry }, { setOrder }) => {
        setOrder(-1)
        if (MMP.audio_formats.test(entry.uri)) {
            return h('button', {
                className: 'mmp-play',
                onClick: () => MMP.audio(entry),
                title: "Play"
            }, '➤')
        }
    })
}


const MMP = {
    cfg,
    audio_formats: cfg.enable_lossless_and_cache 
        ? /\.(aac|flac|mka|mp3|ogg|opus|wav|wma|m4a|aif|aiff|alac|dsd|dsf|dff|ape)$/i
        : /\.(aac|flac|mka|mp3|ogg|opus|wav|m4a)$/i,
    needTranscodeFormats: /\.(dsd|dsf|dff|aif|aiff|ape|alac)$/i,
    playlist: [],
    index: 0,
    isPlaying: false,
    currentFolder: '',
    folderCache: new Map(),
    audioCache: new Map(),
    isDragging: false,
    ffmpegAttempted: false,
    isTranscoded: false,
    audioElement: null,
    lastUpdateTime: 0,
    cachedFormats: /\.(flac|wav)$/i,
    cacheProbeInterval: null,
    currentPlayingUri: '',
    retryCount: 0,
    loadedFromCache: false,
    currentPlayingName: '',
    isRemoteControlled: false,
    storageKey: 'mmp_playlist_data',
    dbName: 'MMPAudioCache',
    dbVersion: 1,
    db: null,
    isDbInitialized: false,
    currentBitrate: 0,
    bitrateCache: new Map(),
    shuffleEnabled: getShuffleState(),
    originalPlaylistOrder: [],
    shuffledPlaylist: [],
    hijackedIcons: new WeakSet(),
    // ========== Preact 钩子相关属性 ==========
    _preactHijackerSetup: false,
    _originalPreactDiffed: null,
    _originalPreactCommit: null,
    _hijackTimeoutId: null,
    _globalInterceptorSetup: false,
    _hijackObserver: null,

    // ========== 检测当前列表是否有音频文件 ==========
    checkAudioInCurrentList() {
        const fileItems = document.querySelectorAll('li.file');
        if (fileItems.length === 0) {
            return false;
        }
        
        for (const li of fileItems) {
            const a = li.querySelector('a[href]');
            if (!a) continue;
            const name = a.textContent?.trim();
            if (name && this.audio_formats.test(name)) {
                return true;
            }
        }
        return false;
    },

    // ========== 判断 VNode 是否为文件列表 ==========
    isFileListVNode(vnode) {
        if (!vnode) return false;
        
        // 检查类型
        if (vnode.type === 'ul' || vnode.type === 'div') {
            const className = vnode.props?.className || '';
            if (typeof className === 'string') {
                if (/file|list|entries/.test(className)) {
                    return true;
                }
            }
        }
        
        // 检查 children 中是否有 li.file
        if (vnode.__k && Array.isArray(vnode.__k)) {
            for (const child of vnode.__k) {
                if (child && child.type === 'li') {
                    const cls = child.props?.className || '';
                    if (typeof cls === 'string' && cls.includes('file')) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    },

    // ========== Preact 钩子劫持器（最可靠） ==========
    setupPreactHijacker() {
        if (this._preactHijackerSetup) return;
        
        // 获取 Preact 实例
        const preact = window.preact || window.Preact;
        if (!preact || !preact.options) {
            // 使用控制台输出（已恢复）
            console.log('MMP: Preact not found, skipping Preact hijacker');
            return;
        }
        
        const options = preact.options;
        console.log('MMP: Setting up Preact hijacker');
        
        // 保存原始回调
        this._originalPreactDiffed = options.diffed;
        this._originalPreactCommit = options.__c;
        
        const self = this;
        let hijackTimer = null;
        
        // 拦截 diffed 阶段（DOM 已更新，但可能未完全提交）
        options.diffed = function(vnode) {
            // 检查是否是文件列表
            if (self.isFileListVNode(vnode)) {
                clearTimeout(hijackTimer);
                hijackTimer = setTimeout(() => {
                    self._scheduleHijack();
                }, 30);
            }
            
            // 调用原始回调
            if (self._originalPreactDiffed) {
                self._originalPreactDiffed(vnode);
            }
        };
        
        // 拦截 commit 阶段（更可靠，DOM 已完全提交）
        options.__c = function(vnode, commitQueue) {
            if (self.isFileListVNode(vnode)) {
                clearTimeout(hijackTimer);
                hijackTimer = setTimeout(() => {
                    self._scheduleHijack();
                }, 10);
            }
            
            // 调用原始回调
            if (self._originalPreactCommit) {
                self._originalPreactCommit(vnode, commitQueue);
            }
        };
        
        this._preactHijackerSetup = true;
        console.log('MMP: Preact hijacker setup complete');
    },

    // ========== 清理 Preact 钩子 ==========
    cleanupPreactHijacker() {
        const preact = window.preact || window.Preact;
        if (!preact || !preact.options) return;
        
        const options = preact.options;
        
        if (this._originalPreactDiffed !== null) {
            options.diffed = this._originalPreactDiffed;
            this._originalPreactDiffed = null;
        }
        
        if (this._originalPreactCommit !== null) {
            options.__c = this._originalPreactCommit;
            this._originalPreactCommit = null;
        }
        
        this._preactHijackerSetup = false;
        if (this._hijackTimeoutId) {
            clearTimeout(this._hijackTimeoutId);
            this._hijackTimeoutId = null;
        }
    },

    // ========== 调度劫持（防抖） ==========
    _scheduleHijack() {
        if (this._hijackTimeoutId) {
            clearTimeout(this._hijackTimeoutId);
        }
        this._hijackTimeoutId = setTimeout(() => {
            this._hijackTimeoutId = null;
            this.hijackAllIcons();
        }, 20);
    },

    // ========== 清理劫持标记 ==========
    cleanupHijackedIcons() {
        document.querySelectorAll('li.file[data-mmp-icon-hijacked="true"]').forEach(el => {
            delete el.dataset.mmpIconHijacked;
        });
        console.log('MMP: 清理劫持标记');
    },

    // ========== 主动触发列表刷新（兜底） ==========
    triggerListRefresh() {
        // 方法1：通过 HFS API 刷新（如果存在）
        if (HFS.refreshList && typeof HFS.refreshList === 'function') {
            HFS.refreshList();
            return;
        }
        
        // 方法2：模拟点击刷新按钮
        const refreshBtn = document.querySelector('.refresh-button, [data-refresh], .btn-refresh');
        if (refreshBtn) {
            refreshBtn.click();
            return;
        }
        
        // 方法3：触发 HFS 内部事件
        if (HFS.emitEvent && typeof HFS.emitEvent === 'function') {
            HFS.emitEvent('refreshRequest', {});
            return;
        }
        
        // 方法4：重新加载当前路径（最后手段）
        if (window.location && window.location.pathname) {
            const currentPath = window.location.pathname + window.location.search;
            // 使用 history API 触发刷新
            if (window.history && window.history.pushState) {
                window.history.pushState({}, '', currentPath);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        }
    },

    async debugSimple(folderPath) {
        console.log('=== SIMPLE DEBUG ===');
        
        let cleanPath = folderPath;
        if (!cleanPath.startsWith('/')) {
            cleanPath = '/' + cleanPath;
        }
        if (!cleanPath.endsWith('/')) {
            cleanPath = cleanPath + '/';
        }
        
        console.log('Clean path:', cleanPath);
        console.log('Encoded:', encodeURIComponent(cleanPath));
        
        const apiUrl = `/~/api/get_file_list?uri=${encodeURIComponent(cleanPath)}`;
        console.log('API URL:', apiUrl);
        
        try {
            const response = await fetch(apiUrl);
            console.log('Response status:', response.status);
            
            if (!response.ok) {
                console.error('API returned:', response.status, response.statusText);
                return { error: `HTTP ${response.status}` };
            }
            
            const data = await response.json();
            console.log('Response:', data);
            
            if (data && data.list) {
                console.log(`\nFound ${data.list.length} items:`);
                data.list.forEach(item => {
                    const type = item.isFolder ? '[DIR]' : '[FILE]';
                    const isAudio = this.audio_formats && this.audio_formats.test(item.n) ? ' [AUDIO]' : '';
                    console.log(`  ${type} ${item.n}${isAudio}`);
                });
            }
            
            return data;
        } catch (error) {
            console.error('Fetch error:', error);
            return { error: error.message };
        }
    },

    async getRecursivePlaylist(folderUri) {
        console.log('=== Recursive Scan Started ===');
        console.log('Start URI:', folderUri);
        
        let allFiles = [];
        const queue = [folderUri];
        const processed = new Set();
        
        while (queue.length > 0) {
            const currentUri = queue.shift();
            
            if (processed.has(currentUri)) continue;
            processed.add(currentUri);
            
            try {
                let scanUri = currentUri;
                if (!scanUri.endsWith('/')) scanUri = scanUri + '/';
                
                const apiUrl = `${scanUri}?get=list&folders=*`;
                console.log('Scanning:', apiUrl);
                
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    console.warn(`Failed: ${response.status}`);
                    continue;
                }
                
                const text = await response.text();
                const lines = text.split('\n').filter(line => line.trim());
                
                console.log(`Found ${lines.length} items`);
                
                for (const line of lines) {
                    const url = line.trim();
                    if (!url) continue;
                    
                    const fileName = decodeURIComponent(url.split('/').pop());
                    
                    if (url.endsWith('/')) {
                        console.log(`  [DIR] Found folder: ${fileName}`);
                        queue.push(url);
                    } else {
                        if (/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff)$/i.test(fileName)) {
                            console.log(`  [AUDIO] Found: ${fileName}`);
                            allFiles.push({
                                name: fileName,
                                uri: url,
                                size: 0
                            });
                        }
                    }
                }
                
                await new Promise(r => setTimeout(r, 200));
                
            } catch (error) {
                console.error(`Error scanning ${currentUri}:`, error);
            }
        }
        
        const unique = [];
        const seen = new Set();
        for (const file of allFiles) {
            if (!seen.has(file.uri)) {
                seen.add(file.uri);
                unique.push(file);
            }
        }
        
        console.log(`\n=== Complete: Found ${unique.length} audio files ===`);
        if (unique.length > 0) {
            console.log('First 5 files:');
            unique.slice(0, 5).forEach((f, i) => {
                console.log(`  ${i+1}. ${f.name}`);
            });
        }
        
        return unique;
    },

    async playFolder(entry) {
        console.log('=== Play Folder ===');
        console.log('Entry:', entry);
        
        let folderUri = entry.uri;
        
        if (folderUri && !folderUri.startsWith('/')) {
            folderUri = '/' + folderUri;
        }
        
        if (folderUri && !folderUri.endsWith('/')) {
            folderUri = folderUri + '/';
        }
        
        console.log('Final folder URI:', folderUri);
        console.log('Folder name:', entry.name);
        
        const root = document.getElementById('mmp-audio');
        if (root) {
            root.style.display = 'flex';
            const title = root.querySelector('.mmp-title');
            if (title) {
                title.textContent = `Scanning: ${entry.name || 'folder'}...`;
            }
        }
        
        try {
            const testUrl = `/~/api/get_file_list?uri=${encodeURIComponent(folderUri)}`;
            console.log('Test API:', testUrl);
            
            const testResponse = await fetch(testUrl);
            if (!testResponse.ok) {
                throw new Error(`Cannot access folder: HTTP ${testResponse.status}`);
            }
            
            const playlist = await this.getRecursivePlaylist(folderUri);
            
            console.log(`Scan complete! Found ${playlist.length} audio files`);
            
            if (playlist.length === 0) {
                const title = root?.querySelector('.mmp-title');
                if (title) {
                    title.textContent = `No audio files in "${entry.name}"`;
                    title.style.color = 'var(--bad)';
                }
                console.error('No audio files found!');
                return;
            }
            
            const title = root?.querySelector('.mmp-title');
            if (title) {
                title.textContent = `${playlist.length} songs - ${entry.name}`;
                title.style.color = '';
                setTimeout(() => {
                    if (title && title.textContent && title.textContent.includes('songs -')) {
                        title.textContent = playlist[0].name.replace(/\.[^.]+$/, '');
                    }
                }, 2000);
            }
            
            this.originalPlaylistOrder = [...playlist];
            
            if (this.shuffleEnabled) {
                for (let i = playlist.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
                }
                this.playlist = playlist;
                this.index = 0;
                this.shuffledPlaylist = [...this.playlist];
            } else {
                this.playlist = playlist;
                this.index = 0;
            }
            
            this.currentFolder = folderUri;
            
            await this.play(this.playlist[this.index]);
            
        } catch (error) {
            console.error('Error in playFolder:', error);
            const title = root?.querySelector('.mmp-title');
            if (title) {
                title.textContent = `Error: ${error.message}`;
                title.style.color = 'var(--bad)';
            }
        }
    },

    async init() {
        const savedVol = localStorage.getItem('mmp_volume')
        if (savedVol) {
            this.cfg.audio_vol = parseFloat(savedVol)
        }
        
        if (this.cfg.enable_cache) {
            this.restoreCachedPlaylists()
        }
        
        if (this.cfg.enable_cache) {
            await this.initIndexedDB()
        }
        
        this.initPlayerElement()
        this.setupAudioBindings()
        
        if (window.HFS && HFS.onEvent) {
            
            // ========== 第一层拦截：entryIcon:after 清空 output ==========
            // 阻止 hfs-click-icon-to-show 在图标上绑定 HFS.fileShow
            if (cfg.auto_play) {
                HFS.onEvent('entryIcon:after', ({ def, entry }, { output }) => {
                    if (!MMP.audio_formats.test(entry.uri)) return;
                    
                    // 保留其他插件（MVfiles-covers）的封面图标
                    const iconDef = output.find(Boolean) || def;
                    
                    // 清空 output，阻止 hfs-click-icon-to-show 添加它的包裹
                    output.length = 0;
                    
                    // 返回带标记的图标，但不在这里绑定事件（交给 DOM 劫持）
                    return HFS.h('span', {
                        class: 'mmp-audio-icon-target',
                        'data-mmp-audio': 'true',
                        style: 'cursor:pointer;display:inline-block;',
                        title: 'Play with Musicplayer+'
                    }, iconDef);
                });
            }
            
            HFS.onEvent('configChanged', (newCfg) => {
                this.cfg = { ...this.cfg, ...newCfg }
                document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
            })
            
            // ========== 修改：afterList 事件 - 增强劫持 ==========
            HFS.onEvent('afterList', () => {
                if (this.isPlaying) {
                    document.getElementById('mmp-audio').style.display = 'flex'
                }
                
                if (cfg.auto_play) {
                    // 立即尝试劫持
                    this.hijackAllIcons();
                    
                    // 延迟多次重试，覆盖不同渲染阶段
                    [50, 150, 350, 700, 1200].forEach(delay => {
                        setTimeout(() => {
                            // 检查是否有未劫持的音频文件
                            const unHijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                            let hasAudio = false;
                            for (const li of unHijacked) {
                                const a = li.querySelector('a[href]');
                                const name = a?.textContent?.trim();
                                if (name && this.audio_formats.test(name)) {
                                    hasAudio = true;
                                    break;
                                }
                            }
                            if (hasAudio) {
                                this.hijackAllIcons();
                            }
                        }, delay);
                    });
                    
                    // 兜底检查：如果还有未劫持的音频文件，尝试刷新列表
                    setTimeout(() => {
                        const unHijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                        let hasUnhijackedAudio = false;
                        for (const li of unHijacked) {
                            const a = li.querySelector('a[href]');
                            const name = a?.textContent?.trim();
                            if (name && this.audio_formats.test(name)) {
                                hasUnhijackedAudio = true;
                                break;
                            }
                        }
                        
                        if (hasUnhijackedAudio) {
                            console.log('MMP: 发现未劫持的音频文件，尝试刷新列表');
                            // 先尝试 Preact 钩子再次劫持
                            this._scheduleHijack();
                            // 如果还是不行，触发列表刷新
                            setTimeout(() => {
                                const stillUnhijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                                let stillHasAudio = false;
                                for (const li of stillUnhijacked) {
                                    const a = li.querySelector('a[href]');
                                    const name = a?.textContent?.trim();
                                    if (name && this.audio_formats.test(name)) {
                                        stillHasAudio = true;
                                        break;
                                    }
                                }
                                if (stillHasAudio) {
                                    console.log('MMP: 劫持仍然失败，触发列表刷新');
                                    this.triggerListRefresh();
                                }
                            }, 500);
                        }
                    }, 1500);
                }
            })

            if (this.cfg.enable_cache) {
                window.addEventListener('beforeunload', () => {
                    this.persistPlaylistData()
                })
            }

            HFS.onEvent('remotePlay', ({ uri }) => {
                this.handleRemotePlay(uri)
            })

            HFS.onEvent('remoteStop', () => {
                this.handleRemoteStop()
            })
        }
        
        // ========== 第二层拦截：DOM 劫持（兜底） ==========
        if (cfg.auto_play) {
            this.startIconHijacker();
        }
        
        // ========== 第三层拦截：Preact 钩子（最可靠） ==========
        if (cfg.auto_play) {
            // 延迟一点设置 Preact 钩子，确保 Preact 已加载
            setTimeout(() => {
                this.setupPreactHijacker();
            }, 50);
        }
        
        // ========== 第四层拦截：全局点击兜底 ==========
        if (cfg.auto_play) {
            this.setupGlobalClickInterceptor();
        }
    },

    // ========== 全局点击拦截（最后防线） ==========
    setupGlobalClickInterceptor() {
        if (this._globalInterceptorSetup) return;
        this._globalInterceptorSetup = true;
        
        const self = this;
        document.addEventListener('click', function(e) {
            const target = e.target.closest('li.file');
            if (!target) return;
            
            // 如果已经被劫持，跳过
            if (target.dataset.mmpIconHijacked === 'true') return;
            
            const a = target.querySelector('a[href]');
            if (!a) return;
            
            const name = a.textContent?.trim();
            if (!name || !self.audio_formats.test(name)) return;
            
            // 检查点击的是否是图标区域
            const icon = target.querySelector('span.icon, [class*="media-icon"]');
            if (!icon || !icon.contains(e.target)) return;
            
            // 拦截
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            
            const entry = self.findEntryByName(name) || { 
                name, 
                uri: a.href,
                ext: name.split('.').pop().toLowerCase()
            };
            self.audio(entry);
            target.dataset.mmpIconHijacked = 'true';
            console.log('MMP: 通过全局拦截捕获点击:', name);
        }, true); // 捕获阶段
        console.log('MMP: 全局点击拦截器已设置');
    },

    // ========== 图标劫持系统 ==========
    startIconHijacker() {
        if (!cfg.auto_play) return;
        
        // 多次延时劫持，覆盖不同渲染阶段
        [200, 500, 1000, 2000, 3000].forEach(delay => {
            setTimeout(() => this.hijackAllIcons(), delay);
        });
        
        const self = this;
        let debounceTimer = null;
        
        const observer = new MutationObserver((mutations) => {
            let shouldHijack = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.querySelector && (
                                node.querySelector('li.file') ||
                                node.classList.contains('file') ||
                                node.classList.contains('list-wrapper') ||
                                node.querySelector('.icon')
                            )) {
                                shouldHijack = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldHijack) break;
            }
            if (shouldHijack) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    // 检查是否有音频文件
                    if (self.checkAudioInCurrentList()) {
                        self.hijackAllIcons();
                        // 二次确认
                        setTimeout(() => {
                            const unHijacked = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
                            for (const li of unHijacked) {
                                const a = li.querySelector('a[href]');
                                const name = a?.textContent?.trim();
                                if (name && self.audio_formats.test(name)) {
                                    self.hijackAllIcons();
                                    break;
                                }
                            }
                        }, 100);
                    }
                }, 100);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // 保存 observer 以便清理
        this._hijackObserver = observer;
    },

    hijackAllIcons() {
        if (!cfg.auto_play) return;
        
        // 快速检查是否有音频文件
        if (!this.checkAudioInCurrentList()) {
            return;
        }
        
        const fileItems = document.querySelectorAll('li.file:not([data-mmp-icon-hijacked="true"])');
        if (fileItems.length === 0) return;
        
        let hijackedCount = 0;
        let audioCount = 0;
        
        fileItems.forEach((li) => {
            const a = li.querySelector('a[href]');
            const name = a?.textContent?.trim();
            if (!name || !this.audio_formats.test(name)) return;
            
            audioCount++;
            
            // 优先找我们标记的图标包裹，其次找普通图标
            let icon = li.querySelector('.mmp-audio-icon-target');
            if (!icon) {
                icon = li.querySelector('span.icon, [class*="media-icon"]');
                if (icon) {
                    // 找到父级包裹元素
                    if (icon.parentElement && icon.parentElement.tagName === 'SPAN' && 
                        icon.parentElement !== li.querySelector('a') &&
                        icon.parentElement.querySelector('span.icon, [class*="media-icon"]')) {
                        icon = icon.parentElement;
                    }
                }
            }
            if (!icon) return;
            
            li.dataset.mmpIconHijacked = 'true';
            hijackedCount++;
            
            const entry = this.findEntryByName(name) || { 
                name, 
                uri: a.href,
                ext: name.split('.').pop().toLowerCase()
            };
            
            icon.style.cursor = 'pointer';
            icon.title = 'Play with Musicplayer+';
            
            this.hijackElementClicks(icon, entry);
        });
        
        if (audioCount > 0 && hijackedCount > 0) {
            console.log(`MMP: 劫持 ${hijackedCount}/${audioCount} 个音频图标`);
        }
    },

    hijackElementClicks(element, entry) {
        if (!element || this.hijackedIcons.has(element)) return;
        
        this.hijackedIcons.add(element);
        
        // 捕获阶段拦截，优先级最高
        element.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            e.stopPropagation();
            e.preventDefault();
            this.audio(entry);
        }, true);
        
        // 冒泡阶段也拦截，双重保险
        element.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            e.stopPropagation();
            e.preventDefault();
            this.audio(entry);
        }, false);
    },

    // 显示当前播放文件的 fileMenu
    async showFileMenuForCurrentSong() {
        if (!this.currentPlayingUri) {
            console.log('No song currently playing');
            return;
        }
        
        try {
            const fileName = this.currentPlayingName + (this.currentPlayingUri.match(/\.[^.]+$/)?.[0] || '');
            const folderUri = this.currentPlayingUri.replace(/\/[^/]+$/, '') + '/';
            
            const entry = {
                name: fileName,
                uri: this.currentPlayingUri,
                isFolder: false,
                ext: fileName.split('.').pop().toLowerCase()
            };
            
            const response = await fetch(`/~/api/get_file_list?uri=${encodeURIComponent(folderUri)}`);
            const data = await response.json();
            const fileInfo = data.list?.find(f => f.n === fileName);
            
            if (fileInfo) {
                entry.size = fileInfo.s;
                entry.modified = fileInfo.m;
            }
            
            if (HFS.onEvent && HFS.emitEvent) {
                const menuContainer = this.createFileMenuContainer(entry);
                if (menuContainer) {
                    document.body.appendChild(menuContainer);
                }
            } else {
                this.showSimpleFileMenu(entry);
            }
        } catch (error) {
            console.error('Failed to show file menu:', error);
            this.showSimpleFileMenu({ uri: this.currentPlayingUri, name: this.currentPlayingName });
        }
    },
    
    createFileMenuContainer(entry) {
        try {
            const menuItems = [];
            
            menuItems.push({
                id: 'download',
                label: 'Download',
                icon: 'download',
                onClick: () => this.downloadCurrentFile()
            });
            
            menuItems.push({
                id: 'info',
                label: 'File Info',
                icon: 'info',
                onClick: () => this.showFileInfo(entry)
            });
            
            const menu = document.createElement('div');
            menu.className = 'mmp-filemenu-popup';
            menu.style.cssText = `
                position: fixed;
                background: var(--bg);
                border: 1px solid var(--text);
                border-radius: 0.4em;
                padding: 0.3em 0;
                min-width: 150px;
                z-index: 10000;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            `;
            
            menuItems.forEach(item => {
                const menuItem = document.createElement('div');
                menuItem.className = 'mmp-filemenu-item';
                menuItem.style.cssText = `
                    padding: 0.5em 1em;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5em;
                    transition: background 0.2s;
                `;
                menuItem.innerHTML = `
                    <span style="font-size: 1em;">${item.icon === 'download' ? '⬇️' : item.icon === 'info' ? 'ℹ️' : '📄'}</span>
                    <span>${item.label}</span>
                `;
                menuItem.onmouseover = () => menuItem.style.background = 'var(--faint-contrast)';
                menuItem.onmouseout = () => menuItem.style.background = '';
                menuItem.onclick = () => {
                    item.onClick();
                    menu.remove();
                };
                menu.appendChild(menuItem);
            });
            
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                    document.removeEventListener('contextmenu', closeMenu);
                }
            };
            setTimeout(() => {
                document.addEventListener('click', closeMenu);
                document.addEventListener('contextmenu', closeMenu);
            }, 0);
            
            const fileMenuBtn = document.querySelector('.mmp-filemenu-btn');
            if (fileMenuBtn) {
                const rect = fileMenuBtn.getBoundingClientRect();
                menu.style.bottom = (window.innerHeight - rect.top + 5) + 'px';
                menu.style.right = (window.innerWidth - rect.right) + 'px';
            } else {
                menu.style.bottom = '50px';
                menu.style.right = '10px';
            }
            
            return menu;
        } catch (e) {
            console.error('Error creating file menu:', e);
            return null;
        }
    },
    
    showSimpleFileMenu(entry) {
        const menu = document.createElement('div');
        menu.className = 'mmp-filemenu-popup';
        menu.style.cssText = `
            position: fixed;
            background: var(--bg);
            border: 1px solid var(--text);
            border-radius: 0.4em;
            padding: 0.3em 0;
            min-width: 150px;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        `;
        
        const items = [
            { label: 'Download', action: () => this.downloadCurrentFile() },
            { label: 'File Info', action: () => this.showFileInfo(entry) }
        ];
        
        items.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 0.5em 1em;
                cursor: pointer;
                transition: background 0.2s;
            `;
            menuItem.onmouseover = () => menuItem.style.background = 'var(--faint-contrast)';
            menuItem.onmouseout = () => menuItem.style.background = '';
            menuItem.onclick = () => {
                item.action();
                menu.remove();
            };
            menu.appendChild(menuItem);
        });
        
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
        
        const fileMenuBtn = document.querySelector('.mmp-filemenu-btn');
        if (fileMenuBtn) {
            const rect = fileMenuBtn.getBoundingClientRect();
            menu.style.bottom = (window.innerHeight - rect.top + 5) + 'px';
            menu.style.right = (window.innerWidth - rect.right) + 'px';
        } else {
            menu.style.bottom = '50px';
            menu.style.right = '10px';
        }
        
        document.body.appendChild(menu);
    },
    
    downloadCurrentFile() {
        if (this.currentPlayingUri) {
            const link = document.createElement('a');
            link.href = this.currentPlayingUri;
            link.download = this.currentPlayingName + (this.currentPlayingUri.match(/\.[^.]+$/)?.[0] || '');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    },
    
    showFileInfo(entry) {
        const infoDialog = document.createElement('div');
        infoDialog.className = 'mmp-fileinfo-dialog';
        infoDialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--bg);
            border: 2px solid var(--text);
            border-radius: 0.5em;
            padding: 1.5em;
            z-index: 10001;
            min-width: 250px;
            max-width: 400px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;
        
        infoDialog.innerHTML = `
            <h3 style="margin: 0 0 1em 0; border-bottom: 1px solid var(--text); padding-bottom: 0.5em;">File Information</h3>
            <div style="margin-bottom: 0.5em;"><strong>Name:</strong> ${this.currentPlayingName}</div>
            <div style="margin-bottom: 0.5em;"><strong>URI:</strong> <span style="word-break: break-all;">${this.currentPlayingUri}</span></div>
            ${entry.size ? `<div style="margin-bottom: 0.5em;"><strong>Size:</strong> ${this.formatFileSize(entry.size)}</div>` : ''}
            ${entry.modified ? `<div style="margin-bottom: 0.5em;"><strong>Modified:</strong> ${new Date(entry.modified).toLocaleString()}</div>` : ''}
            <div style="margin-bottom: 0.5em;"><strong>Format:</strong> ${this.currentPlayingUri.match(/\.[^.]+$/)?.[0]?.toUpperCase() || 'Unknown'}</div>
            ${this.currentBitrate ? `<div style="margin-bottom: 0.5em;"><strong>Bitrate:</strong> ${this.formatBitrateWithUnits(this.currentBitrate)}</div>` : ''}
            <div style="margin-top: 1.5em; text-align: right;">
                <button style="padding: 0.3em 1em; cursor: pointer;">Close</button>
            </div>
        `;
        
        const closeBtn = infoDialog.querySelector('button');
        closeBtn.onclick = () => infoDialog.remove();
        
        infoDialog.addEventListener('click', (e) => {
            if (e.target === infoDialog) infoDialog.remove();
        });
        
        document.body.appendChild(infoDialog);
    },
    
    formatFileSize(bytes) {
        if (!bytes) return 'Unknown';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    },

    addFileMenuButton() {
        const headerControls = document.querySelector('.mmp-header-controls');
        if (!headerControls) return;
        
        if (document.querySelector('.mmp-filemenu-btn')) return;
        
        const fileMenuBtn = document.createElement('button');
        fileMenuBtn.type = 'button';
        fileMenuBtn.className = 'mmp-filemenu-btn';
        fileMenuBtn.title = 'File Menu';
        fileMenuBtn.textContent = '☰';
        
        fileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showFileMenuForCurrentSong();
        });
        
        const volumeControl = headerControls.querySelector('.mmp-volume-control');
        const closeBtn = headerControls.querySelector('.mmp-close');
        
        if (volumeControl && closeBtn) {
            headerControls.insertBefore(fileMenuBtn, closeBtn);
        } else {
            headerControls.appendChild(fileMenuBtn);
        }
    },

    toggleShuffle() {
        this.shuffleEnabled = !this.shuffleEnabled;
        setShuffleState(this.shuffleEnabled);
        
        const shuffleBtn = document.querySelector('.mmp-shuffle-btn');
        if (shuffleBtn) {
            shuffleBtn.textContent = this.shuffleEnabled ? '⋈' : '⇌';
        }
        
        if (this.playlist.length > 0) {
            if (this.shuffleEnabled) {
                if (this.originalPlaylistOrder.length === 0) {
                    this.originalPlaylistOrder = [...this.playlist];
                }
                const currentSong = this.playlist[this.index];
                const otherSongs = this.playlist.filter((_, i) => i !== this.index);
                for (let i = otherSongs.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [otherSongs[i], otherSongs[j]] = [otherSongs[j], otherSongs[i]];
                }
                this.shuffledPlaylist = [currentSong, ...otherSongs];
                this.playlist = this.shuffledPlaylist;
                this.index = 0;
            } else {
                if (this.originalPlaylistOrder.length > 0) {
                    const currentSongUri = this.playlist[this.index].uri;
                    const newIndex = this.originalPlaylistOrder.findIndex(song => song.uri === currentSongUri);
                    this.playlist = [...this.originalPlaylistOrder];
                    this.index = newIndex >= 0 ? newIndex : 0;
                }
            }
        }
        
        console.log(`Shuffle ${this.shuffleEnabled ? 'enabled' : 'disabled'}`);
    },

    getNextShuffleIndex() {
        if (!this.shuffleEnabled || this.playlist.length <= 1) {
            return (this.index + 1) % this.playlist.length;
        }
        
        let nextIndex;
        do {
            nextIndex = Math.floor(Math.random() * this.playlist.length);
        } while (nextIndex === this.index && this.playlist.length > 1);
        
        return nextIndex;
    },

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion)
            
            request.onerror = () => {
                console.warn('Failed to open IndexedDB for audio cache')
                this.isDbInitialized = false
                reject(request.error)
            }
            
            request.onsuccess = () => {
                this.db = request.result
                this.isDbInitialized = true
                console.log('IndexedDB for audio cache initialized')
                resolve()
            }
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result
                if (!db.objectStoreNames.contains('audioCache')) {
                    const store = db.createObjectStore('audioCache', { keyPath: 'uri' })
                    store.createIndex('timestamp', 'timestamp', { unique: false })
                }
            }
        })
    },

    async getCachedAudioFromDB(uri) {
        if (!this.isDbInitialized) return null
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readonly')
            const store = transaction.objectStore('audioCache')
            const request = store.get(uri)
            
            request.onsuccess = () => {
                const result = request.result
                if (result) {
                    const blob = new Blob([result.data], { type: result.contentType })
                    const blobUrl = URL.createObjectURL(blob)
                    resolve({
                        blobUrl,
                        size: result.size,
                        timestamp: result.timestamp
                    })
                } else {
                    resolve(null)
                }
            }
            
            request.onerror = () => {
                console.warn('Error reading from audio cache:', request.error)
                resolve(null)
            }
        })
    },

    async cacheAudioToDB(uri, arrayBuffer, contentType) {
        if (!this.isDbInitialized) return false
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readwrite')
            const store = transaction.objectStore('audioCache')
            
            const audioData = {
                uri: uri,
                data: arrayBuffer,
                contentType: contentType,
                size: arrayBuffer.byteLength,
                timestamp: Date.now()
            }
            
            const request = store.put(audioData)
            
            request.onsuccess = async () => {
                resolve(true)
            }
            
            request.onerror = () => {
                console.warn('Error storing audio in cache:', request.error)
                resolve(false)
            }
        })
    },

    async removeCachedAudioFromDB(uri) {
        if (!this.isDbInitialized) return
        
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['audioCache'], 'readwrite')
            const store = transaction.objectStore('audioCache')
            const request = store.delete(uri)
            
            request.onsuccess = () => resolve()
            request.onerror = () => resolve()
        })
    },

    async getCachedAudio(uri) {
        if (!this.cfg.enable_cache) return null
        
        const memoryCached = this.audioCache.get(uri)
        if (memoryCached && memoryCached.blobUrl) {
            if (Date.now() - memoryCached.timestamp < 3600000) {
                return memoryCached.blobUrl
            } else {
                URL.revokeObjectURL(memoryCached.blobUrl)
                this.audioCache.delete(uri)
            }
        }
        
        const dbCached = await this.getCachedAudioFromDB(uri)
        if (dbCached) {
            this.audioCache.set(uri, dbCached)
            return dbCached.blobUrl
        }
        
        return null
    },

    async cacheAudio(uri, arrayBuffer, contentType) {
        if (!this.cfg.enable_cache) return null
        
        try {
            const storedInDB = await this.cacheAudioToDB(uri, arrayBuffer, contentType)
            
            if (storedInDB) {
                const blob = new Blob([arrayBuffer], { type: contentType })
                const blobUrl = URL.createObjectURL(blob)
                
                const cacheInfo = {
                    blobUrl,
                    size: arrayBuffer.byteLength,
                    timestamp: Date.now(),
                    contentType
                }
                
                this.audioCache.set(uri, cacheInfo)
                return blobUrl
            }
        } catch (e) {
            console.warn('Failed to cache audio:', e)
        }
        
        return null
    },

    persistPlaylistData() {
        if (!this.cfg.enable_cache) return;
        
        try {
            const dataToSave = {
                folderCache: Array.from(this.folderCache.entries()),
                currentFolder: this.currentFolder,
                playlist: this.playlist,
                originalPlaylistOrder: this.originalPlaylistOrder,
                shuffledPlaylist: this.shuffledPlaylist,
                timestamp: Date.now()
            }
            localStorage.setItem(this.storageKey, JSON.stringify(dataToSave))
        } catch (e) {
            console.warn('Failed to persist playlist data:', e)
        }
    },

    restoreCachedPlaylists() {
        if (!this.cfg.enable_cache) return;
        
        try {
            const saved = localStorage.getItem(this.storageKey)
            if (saved) {
                const data = JSON.parse(saved)
                if (Date.now() - data.timestamp < 3600000) {
                    this.folderCache = new Map(data.folderCache || [])
                    this.currentFolder = data.currentFolder || ''
                    this.playlist = data.playlist || []
                    this.originalPlaylistOrder = data.originalPlaylistOrder || []
                    this.shuffledPlaylist = data.shuffledPlaylist || []
                }
            }
        } catch (e) {
            console.warn('Failed to restore cached playlists:', e)
        }
    },

    async getPlaylist(folderUri, forceRefresh = false) {
        if (!this.cfg.enable_cache) {
            return this.fetchPlaylistFromServer(folderUri)
        }
        
        if (forceRefresh || !this.folderCache.has(folderUri)) {
            const playlist = await this.fetchPlaylistFromServer(folderUri)
            this.folderCache.set(folderUri, playlist)
            this.persistPlaylistData()
            return playlist
        }
        
        return this.folderCache.get(folderUri)
    },

    async fetchPlaylistFromServer(folderUri) {
        try {
            const res = await fetch(`/~/api/get_file_list?uri=${encodeURIComponent(folderUri)}`)
            const data = await res.json()
            const raw = data.list || []

            return raw
                .filter(f => this.audio_formats.test(f.n))
                .map(f => ({
                    name: f.n,
                    uri: folderUri + encodeURIComponent(f.n)
                }))
        } catch (e) {
            console.error('Failed to fetch playlist:', e)
            return []
        }
    },

    handleRemotePlay(uri) {
        if (!uri) return
        
        this.isRemoteControlled = true
        
        const folderUri = uri.replace(/\/[^/]+$/, '') + '/'
        
        this.getPlaylist(folderUri).then(playlist => {
            this.playRemoteFile(uri, playlist)
        }).catch(() => {
            this.playRemoteFile(uri, [])
        })
    },

    playRemoteFile(uri, playlist) {
        const fileName = decodeURIComponent(uri.split('/').pop())
        
        this.playlist = playlist.length > 0 ? playlist : [{ name: fileName, uri }]
        
        const idx = this.playlist.findIndex(f =>
            f.uri === uri || decodeURIComponent(f.uri) === decodeURIComponent(uri)
        )
        
        this.index = idx >= 0 ? idx : 0
        this.play(this.playlist[this.index])
    },

    handleRemoteStop() {
        this.isRemoteControlled = false
        
        if (this.currentPlayingUri) {
            const currentFolder = this.currentPlayingUri.replace(/\/[^/]+$/, '') + '/'
            if (currentFolder !== this.currentFolder) {
                this.getPlaylist(currentFolder).catch(() => {})
            }
        }
    },

    findEntryByName(name) {
        const list = window.HFS?.state?.list || []
        return list.find(e => e.n === name)
    },

    initPlayerElement() {
        document.documentElement.style.setProperty('--mmp-custom-height', this.cfg.button_height || '4vw')
        
        const progressHTML = `
            <div class='mmp-progress-container'>
                <input type="range" class='mmp-progress-bar' min="0" max="10000" value="0" step="1">
                <div class='mmp-loading-indicator'></div>
            </div>`
        
        const bitrateHTML = this.cfg.show_bitrate ? `
            <span class='mmp-bitrate'></span>
        ` : ''
        
        const playerHTML = `
        <div id='mmp-audio' class='mmp' style='display:none'>
            <audio class='mmp-media'></audio>
            <div class='mmp-header'>
                <span class='mmp-time'></span>
                ${bitrateHTML}
                <div class='mmp-title-container'>
                    <div class='mmp-title'></div>
                </div>
                <div class='mmp-header-controls'>
                    <button type="button" class='mmp-shuffle-btn' title="Shuffle">${this.shuffleEnabled ? '⋈' : '⇌'}</button>
                    <div class='mmp-volume-control'>
                        <button type="button" class='mmp-vol-down' title="Decrease volume">−</button>
                        <span class='mmp-volume-value'>${Math.round(this.cfg.audio_vol * 100)}%</span>
                        <button type="button" class='mmp-vol-up' title="Increase volume">+</button>
                    </div>
                    <button type="button" class='mmp-close' title="Close">✕</button>
                </div>
            </div>
            ${progressHTML}
            <div class='mmp-controls'>
            <div class='mmp-buttons'>
                <div class='mmp-playback-buttons'>
                    <button type="button" class='mmp-prev' title="Previous">I◁◁</button>
                    <button type="button" class='mmp-play-pause' title="Play/Pause">➤</button>
                    <button type="button" class='mmp-next' title="Next">▷▷I</button>
                </div>
                <button type="button" class='mmp-custom-button ${this.cfg.hide_back_btn_portrait ? 'hide-portrait' : ''}' title="Go back">▲</button>
            </div>
        </div>
    </div>`;
        document.body.insertAdjacentHTML('beforeend', playerHTML)

        this.audioElement = document.querySelector('#mmp-audio audio')
        
        this.addFileMenuButton();
        
        const shuffleBtn = document.querySelector('.mmp-shuffle-btn')
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', () => this.toggleShuffle())
        }

        document.querySelector('.mmp-prev')?.addEventListener('click', () => {
            setTimeout(() => this.playPrev(), 300)
        })
        document.querySelector('.mmp-play-pause')?.addEventListener('click', () => this.togglePlay())
        document.querySelector('.mmp-next')?.addEventListener('click', () => {
            setTimeout(() => this.playNext(), 300)
        })
        document.querySelector('.mmp-vol-down')?.addEventListener('click', () => this.adjustVolume(-5))
        document.querySelector('.mmp-vol-up')?.addEventListener('click', () => this.adjustVolume(5))
        document.querySelector('.mmp-close')?.addEventListener('click', () => this.stop())
        
        document.querySelector('.mmp-custom-button')?.addEventListener('click', () => {
            const upButton = document.querySelector('.header a[href*="parent="]')
            if (upButton) {
                upButton.click()
            } else {
                window.history.back()
            }
        })
        
        const progressBar = document.querySelector('.mmp-progress-bar')
        if (progressBar) {
            const audio = this.audioElement
            
            progressBar.addEventListener('mousedown', () => {
                if (!this.isTranscoded) this.isDragging = true
            })

            progressBar.addEventListener('touchstart', () => {
                if (!this.isTranscoded) this.isDragging = true
            }, { passive: true })

            progressBar.addEventListener('input', (e) => {
                if (this.isDragging && audio?.duration && isFinite(audio.duration) && !this.isTranscoded) {
                    const seekTime = (e.target.value / 10000) * audio.duration
                    audio.currentTime = seekTime
                }
            })

            progressBar.addEventListener('mouseup', (e) => {
                if (!this.isTranscoded) {
                    this.handleProgressChange(e)
                    this.isDragging = false
                }
            })

            progressBar.addEventListener('touchend', (e) => {
                if (!this.isTranscoded) {
                    this.handleProgressChange(e)
                    this.isDragging = false
                }
            }, { passive: true })

            progressBar.addEventListener('touchmove', (e) => {
                if (this.isDragging && !this.isTranscoded) {
                    e.preventDefault()
                    const touch = e.touches[0]
                    const rect = progressBar.getBoundingClientRect()
                    const percent = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width))
                    progressBar.value = percent * 10000
                    if (audio?.duration && isFinite(audio.duration)) {
                        audio.currentTime = percent * audio.duration
                    }
                }
            }, { passive: false })

            if (audio) {
                audio.ontimeupdate = () => this.updateTimeDisplay(audio)
            }
        }
    },

    updateTimeDisplay(audio) {
        const timeDisplay = document.querySelector('.mmp-time')
        const progressBar = document.querySelector('.mmp-progress-bar')
        const bitrateDisplay = document.querySelector('.mmp-bitrate')
        
        if (!timeDisplay) return
        
        if (audio.duration && isFinite(audio.duration)) {
            if (this.cfg.show_countdown && window.innerWidth <= 600) {
                timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`
                timeDisplay.className = 'mmp-time countdown'
            } else {
                timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`
                timeDisplay.className = 'mmp-time normal-time'
            }
            
            if (bitrateDisplay && this.cfg.show_bitrate && this.currentBitrate > 0) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(this.currentBitrate)
            }
        } else {
            const elapsed = (Date.now() - this.lastUpdateTime) / 1000
            timeDisplay.textContent = `Decoding: ${this.formatTime(elapsed)}`
            timeDisplay.className = 'mmp-time decoding'
            
            if (progressBar) {
                progressBar.value = 0
                progressBar.disabled = true
            }
            
            if (bitrateDisplay) {
                bitrateDisplay.textContent = ''
            }
        }
        
        if (progressBar && !this.isDragging) {
            if (audio.duration && isFinite(audio.duration)) {
                progressBar.value = (audio.currentTime / audio.duration) * 10000
                progressBar.disabled = false
            } else {
                progressBar.value = 0
                progressBar.disabled = true
            }
        }
    },

    formatBitrateWithUnits(bitrate) {
        if (bitrate >= 1000000) {
            const mbps = bitrate / 1000000
            return `${mbps.toFixed(1)} Mbps`
        } else if (bitrate >= 1000) {
            const kbps = bitrate / 1000
            if (kbps >= 100) {
                return `${Math.round(kbps)} kbps`
            } else if (kbps >= 10) {
                return `${kbps.toFixed(1)} kbps`
            } else {
                return `${kbps.toFixed(1)} kbps`
            }
        } else {
            return `${Math.round(bitrate)} bps`
        }
    },

    formatBitrate(bitrate) {
        const kbps = Math.round(bitrate / 1000)
        return `${kbps} kbps`
    },

    handleProgressChange(e) {
        const audio = this.audioElement
        if (audio?.duration && isFinite(audio.duration) && !this.isTranscoded) {
            const percent = e.target.value / 10000
            audio.currentTime = percent * audio.duration
        }
        this.isDragging = false
    },

    async audio(entry) {
        if (this.isRemoteControlled) return

        const folderUri = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/'

        if (this.playlist.length && this.currentFolder === folderUri) {
            const idx = this.playlist.findIndex(f =>
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            )
            if (idx >= 0) {
                this.index = idx
                return this.play(this.playlist[this.index])
            }
        }

        const playlist = await this.getPlaylist(folderUri)
        
        this.originalPlaylistOrder = [...playlist];
        
        if (this.shuffleEnabled) {
            const currentSong = playlist.find(f => 
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            );
            const otherSongs = playlist.filter(f => f !== currentSong);
            for (let i = otherSongs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [otherSongs[i], otherSongs[j]] = [otherSongs[j], otherSongs[i]];
            }
            this.playlist = currentSong ? [currentSong, ...otherSongs] : [...otherSongs];
            this.index = 0;
            this.shuffledPlaylist = [...this.playlist];
        } else {
            this.playlist = playlist;
            const idx = this.playlist.findIndex(f =>
                f.uri === entry.uri || decodeURIComponent(f.uri) === decodeURIComponent(entry.uri)
            )
            this.index = idx >= 0 ? idx : 0
        }
        
        this.currentFolder = folderUri
        
        this.play(this.playlist[this.index])
    },

    async play(entry) {
        const root = document.getElementById('mmp-audio')
        if (!root || !this.audioElement) return

        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval)
            this.cacheProbeInterval = null
        }

        const audio = this.audioElement
        const title = root.querySelector('.mmp-title')
        const playPauseBtn = document.querySelector('.mmp-play-pause')
        const progressBar = document.querySelector('.mmp-progress-bar')
        const bitrateDisplay = root.querySelector('.mmp-bitrate')

        root.style.display = 'flex'
        this.isTranscoded = false
        this.loadedFromCache = false
        this.updateLoadingProgress(0)
        this.lastUpdateTime = Date.now()
        this.currentPlayingUri = entry.uri
        this.currentPlayingName = entry.name.replace(/\.[^.]+$/, '')
        this.retryCount = 0

        audio.ontimeupdate = null
        if (progressBar) {
            progressBar.disabled = false
            progressBar.value = 0
        }

        if (title) {
            title.textContent = this.currentPlayingName
            title.style.whiteSpace = 'nowrap'
            title.style.overflow = 'hidden'
            title.style.textOverflow = 'ellipsis'
        }

        const cachedBitrate = this.bitrateCache.get(entry.uri)
        if (cachedBitrate) {
            this.currentBitrate = cachedBitrate
            if (bitrateDisplay && this.cfg.show_bitrate) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(cachedBitrate)
            }
            console.log('Bitrate from cache:', entry.name, '->', cachedBitrate, 'bps')
        } else {
            this.currentBitrate = 0
            if (bitrateDisplay) {
                bitrateDisplay.textContent = ''
            }
        }

        const isSpecialFormat = this.needTranscodeFormats.test(entry.uri)
        
        try {
            let cachedAudioUrl = null
            if (this.cfg.enable_cache) {
                cachedAudioUrl = await this.getCachedAudio(entry.uri)
            }

            if (cachedAudioUrl) {
                audio.src = cachedAudioUrl
                this.isTranscoded = false
                this.loadedFromCache = true
                console.log('Using cached audio:', entry.name)
                
                if (this.currentBitrate === 0) {
                    setTimeout(() => {
                        this.calculateAndCacheBitrate(audio, entry)
                    }, 1000)
                }
            } else {
                let cacheInfo = null
                if (this.cfg.enable_lossless_and_cache && isSpecialFormat) {
                    cacheInfo = await this.checkCachedVersion(entry.uri)
                }

                if (cacheInfo) {
                    audio.src = cacheInfo.cachedUri
                    this.isTranscoded = false
                    this.loadedFromCache = true
                    if (progressBar) progressBar.disabled = false
                    
                    if (this.currentBitrate === 0) {
                        setTimeout(() => {
                            this.calculateAndCacheBitrate(audio, entry)
                        }, 1000)
                    }
                } else if (isSpecialFormat && unsupportedPlugin) {
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    
                    if (progressBar) {
                        progressBar.disabled = true
                    }
                    
                    this.getBitrateFromFfmpeg(entry.uri)
                } else {
                    if (this.cfg.enable_cache) {
                        try {
                            const response = await fetch(entry.uri)
                            const arrayBuffer = await response.arrayBuffer()
                            const contentType = response.headers.get('content-type') || 'audio/mpeg'
                            
                            this.tryParseBitrateFromFile(entry, arrayBuffer, contentType)
                            
                            const cachedUrl = await this.cacheAudio(entry.uri, arrayBuffer, contentType)
                            if (cachedUrl) {
                                audio.src = cachedUrl
                                console.log('Audio cached:', entry.name)
                            } else {
                                audio.src = entry.uri
                            }
                        } catch (fetchError) {
                            audio.src = entry.uri
                            if (this.currentBitrate === 0) {
                                setTimeout(() => {
                                    this.calculateAndCacheBitrate(audio, entry)
                                }, 1000)
                            }
                        }
                    } else {
                        audio.src = entry.uri
                        if (this.currentBitrate === 0) {
                            setTimeout(() => {
                                this.calculateAndCacheBitrate(audio, entry)
                            }, 1000)
                        }
                    }
                    this.isTranscoded = false
                    this.ffmpegAttempted = false
                }
            }
            
            audio.ontimeupdate = () => this.updateTimeDisplay(audio)
            
            if (isAppleDevice && this.isTranscoded) {
                try {
                    await audio.load()
                    await new Promise((resolve, reject) => {
                        audio.oncanplay = resolve
                        audio.onerror = reject
                        setTimeout(() => reject(new Error('加载超时')), 5000)
                    })
                } catch (e) {}
            }
            
            await this.ensureAudioPlayable(audio)
            
            if (this.isTranscoded) {
                audio.oncanplaythrough = () => {
                    if (progressBar) progressBar.disabled = false
                    this.isTranscoded = false
                    audio.ontimeupdate = () => this.updateTimeDisplay(audio)
                    
                    if (this.currentBitrate === 0) {
                        setTimeout(() => {
                            this.calculateAndCacheBitrate(audio, entry)
                        }, 1000)
                    }
                }
                this.startCacheProbe(entry.uri)
            }
            
            this.isPlaying = true
            
            if (playPauseBtn) {
                playPauseBtn.textContent = '➤'
                playPauseBtn.classList.add('playing')
            }
        } catch (e) {
            if (!isSpecialFormat && unsupportedPlugin && !this.ffmpegAttempted) {
                try {
                    audio.src = entry.uri + "?ffmpeg"
                    this.isTranscoded = true
                    this.ffmpegAttempted = true
                    
                    if (progressBar) {
                        progressBar.disabled = true
                    }
                    
                    this.getBitrateFromFfmpeg(entry.uri)
                    
                    await this.ensureAudioPlayable(audio)
                    this.isPlaying = true
                    
                    if (playPauseBtn) {
                        playPauseBtn.textContent = '➤'
                        playPauseBtn.classList.add('playing')
                    }
                    
                    audio.oncanplaythrough = () => {
                        if (progressBar) progressBar.disabled = false
                        this.isTranscoded = false
                    }
                    
                    this.startCacheProbe(entry.uri)
                } catch (e2) {
                    this.showError("Cannot play this audio format")
                    this.pause()
                }
            } else {
                this.showError("Cannot play this audio format")
                this.pause()
            }
        }
        
        audio.volume = this.cfg.audio_vol
        const volDisplay = document.querySelector('.mmp-volume-value')
        if (volDisplay) volDisplay.textContent = `${Math.round(this.cfg.audio_vol * 100)}%`

        audio.onended = () => {
            if (this.cfg.loop_mode === 'single') {
                audio.currentTime = 0
                audio.play()
            } else {
                this.playNext()
            }
        }

        audio.onpause = () => {
            this.isPlaying = false
            if (playPauseBtn) {
                playPauseBtn.textContent = '❚❚'
                playPauseBtn.classList.remove('playing')
            }
        }

        audio.onplay = () => {
            this.isPlaying = true
            if (playPauseBtn) {
                playPauseBtn.textContent = '➤'
                playPauseBtn.classList.add('playing')
            }
        }
    },

    async getBitrateFromFfmpeg(uri) {
        try {
            console.log('Attempting to get bitrate from FFmpeg for:', uri);
            
            const testAudio = new Audio();
            testAudio.src = uri + "?ffmpeg&probe";
            
            testAudio.addEventListener('loadedmetadata', () => {
                console.log('FFmpeg metadata loaded for:', uri);
                
                if (testAudio.duration && testAudio.duration > 0) {
                    this.fetchFileSizeAndCalculateBitrate(uri, testAudio.duration);
                }
            });
            
            testAudio.addEventListener('error', (e) => {
                console.warn('Error loading FFmpeg probe:', e);
            });
            
            testAudio.load();
            
        } catch (e) {
            console.warn('Failed to get bitrate from FFmpeg:', e);
        }
    },

    async fetchFileSizeAndCalculateBitrate(uri, duration) {
        try {
            const response = await fetch(uri, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            
            if (contentLength && duration > 0) {
                const fileSize = parseInt(contentLength);
                const bitrate = Math.round((fileSize * 8) / duration);
                
                console.log('Calculated bitrate from file size:', fileSize, 'bytes, duration:', duration, 'seconds, bitrate:', bitrate, 'bps');
                
                if (bitrate > 0) {
                    this.currentBitrate = bitrate;
                    this.bitrateCache.set(uri, bitrate);
                    
                    const bitrateDisplay = document.querySelector('.mmp-bitrate');
                    if (bitrateDisplay && this.cfg.show_bitrate) {
                        bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch file size:', e);
        }
    },

    tryParseBitrateFromFile(entry, arrayBuffer, contentType) {
        try {
            console.log('Attempting to parse bitrate from file:', entry.name);
            
            const ext = entry.name.split('.').pop().toLowerCase();
            
            switch(ext) {
                case 'mp3':
                    this.parseMp3Bitrate(arrayBuffer, entry);
                    break;
                case 'flac':
                case 'wav':
                case 'aac':
                case 'm4a':
                case 'ogg':
                case 'opus':
                    console.log('Bitrate calculation for', ext, 'will be done from file size/duration');
                    break;
                default:
                    console.log('No specific parser for', ext, 'extension');
            }
            
        } catch (e) {
            console.warn('Failed to parse bitrate from file:', e);
        }
    },

    parseMp3Bitrate(arrayBuffer, entry) {
        try {
            console.log('Parsing MP3 bitrate from file header');
            
            if (arrayBuffer.byteLength < 100) {
                console.log('File too small to parse MP3 header');
                return;
            }
            
            const view = new DataView(arrayBuffer);
            
            for (let i = 0; i < Math.min(1000, arrayBuffer.byteLength - 4); i++) {
                const header = view.getUint32(i);
                
                if ((header & 0xFFE00000) === 0xFFE00000) {
                    console.log('Found MP3 frame header at position', i);
                    
                    const bitrateIndex = (header >> 12) & 0x0F;
                    
                    const mpeg1Layer3Bitrates = [
                        0, 32, 40, 48, 56, 64, 80, 96, 
                        112, 128, 160, 192, 224, 256, 320, 0
                    ];
                    
                    if (bitrateIndex > 0 && bitrateIndex < 15) {
                        const bitrateKbps = mpeg1Layer3Bitrates[bitrateIndex];
                        if (bitrateKbps > 0) {
                            const bitrateBps = bitrateKbps * 1000;
                            console.log('MP3 bitrate from header:', bitrateKbps, 'kbps');
                            
                            this.currentBitrate = bitrateBps;
                            this.bitrateCache.set(entry.uri, bitrateBps);
                            
                            const bitrateDisplay = document.querySelector('.mmp-bitrate');
                            if (bitrateDisplay && this.cfg.show_bitrate) {
                                bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrateBps);
                            }
                            return;
                        }
                    }
                    
                    break;
                }
            }
            
            console.log('Could not parse MP3 bitrate from header');
        } catch (e) {
            console.warn('Failed to parse MP3 bitrate:', e);
        }
    },

    calculateAndCacheBitrate(audio, entry) {
        if (this.currentBitrate > 0) return;
        
        const bitrate = this.calculateBitrateFromAudio(audio, entry);
        if (bitrate > 0) {
            this.currentBitrate = bitrate;
            this.bitrateCache.set(entry.uri, bitrate);
            
            const bitrateDisplay = document.querySelector('.mmp-bitrate');
            if (bitrateDisplay && this.cfg.show_bitrate) {
                bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
            }
            console.log('Calculated bitrate from audio:', entry.name, '->', bitrate, 'bps');
        }
    },

    calculateBitrateFromAudio(audio, entry) {
        try {
            const cachedBitrate = this.bitrateCache.get(entry.uri);
            if (cachedBitrate) {
                console.log('Returning cached bitrate:', cachedBitrate, 'bps');
                return cachedBitrate;
            }
            
            if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
                this.fetchFileSizeAndCalculate(entry.uri, audio.duration);
                return 0;
            }
            
            const ext = entry.name.split('.').pop().toLowerCase();
            const defaultBitrates = {
                'mp3': 320000,
                'aac': 256000,
                'ogg': 320000,
                'opus': 192000,
                'flac': 1000000,
                'wav': 1411000,
                'm4a': 256000,
                'aif': 1411000,
                'aiff': 1411000,
                'alac': 1000000,
                'dsd': 2822400,
                'dsf': 2822400,
                'dff': 2822400,
                'ape': 1000000
            };
            
            const defaultBitrate = defaultBitrates[ext] || 128000;
            console.log('Using default bitrate for', ext, ':', defaultBitrate, 'bps');
            return defaultBitrate;
            
        } catch (e) {
            console.warn('Failed to calculate bitrate from audio:', e);
            return 0;
        }
    },

    async fetchFileSizeAndCalculate(uri, duration) {
        try {
            const response = await fetch(uri, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            
            if (contentLength && duration > 0) {
                const fileSize = parseInt(contentLength);
                const bitrate = Math.round((fileSize * 8) / duration);
                
                console.log('Calculated bitrate from file size:', fileSize, 'bytes, duration:', duration, 'seconds, bitrate:', bitrate, 'bps');
                
                if (bitrate > 0) {
                    this.currentBitrate = bitrate;
                    this.bitrateCache.set(uri, bitrate);
                    
                    const bitrateDisplay = document.querySelector('.mmp-bitrate');
                    if (bitrateDisplay && this.cfg.show_bitrate) {
                        bitrateDisplay.textContent = this.formatBitrateWithUnits(bitrate);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch file size:', e);
        }
    },

    async ensureAudioPlayable(audio) {
        try {
            await audio.play();
            this.retryCount = 0;
        } catch (e) {
            if (this.retryCount < 2) {
                this.retryCount++;
                await new Promise(resolve => setTimeout(resolve, 500));
                return this.ensureAudioPlayable(audio);
            }
            throw e;
        }
    },

    async startCacheProbe(originalUri) {
        if (this.loadedFromCache || !this.cfg.enable_lossless_and_cache || !this.needTranscodeFormats.test(originalUri)) return;
        
        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval);
        }
        
        this.cacheProbeInterval = setInterval(async () => {
            try {
                const cacheInfo = await this.checkCachedVersion(originalUri);
                if (cacheInfo) {
                    await this.switchToCachedVersion(cacheInfo);
                    clearInterval(this.cacheProbeInterval);
                    this.cacheProbeInterval = null;
                }
            } catch (e) {}
        }, 5000);
    },

    async switchToCachedVersion(cacheInfo) {
        if (!this.audioElement || !cacheInfo) return;
        
        const audio = this.audioElement;
        const progressBar = document.querySelector('.mmp-progress-bar');
        const currentTime = audio.currentTime;
        const currentVolume = audio.volume;
        const wasPlaying = !audio.paused;
        
        try {
            audio.pause();
            audio.src = cacheInfo.cachedUri;
            this.isTranscoded = false;
            this.loadedFromCache = true;
            
            await new Promise((resolve) => {
                if (audio.readyState >= 3) {
                    resolve();
                } else {
                    audio.oncanplay = resolve;
                    setTimeout(resolve, 1000);
                }
            });
            
            audio.currentTime = currentTime;
            audio.volume = currentVolume;
            
            audio.ontimeupdate = () => {
                const timeDisplay = document.querySelector('.mmp-time');
                const bitrateDisplay = document.querySelector('.mmp-bitrate');
                
                if (timeDisplay) {
                    if (audio.duration && isFinite(audio.duration)) {
                        if (this.cfg.show_countdown && window.innerWidth <= 600) {
                            timeDisplay.textContent = `-${this.formatTime(audio.duration - audio.currentTime)}`;
                            timeDisplay.className = 'mmp-time countdown';
                        } else {
                            timeDisplay.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
                            timeDisplay.className = 'mmp-time normal-time';
                        }
                    } else {
                        timeDisplay.textContent = `${this.formatTime(audio.currentTime)}`;
                        timeDisplay.className = 'mmp-time normal-time';
                    }
                }
                
                if (bitrateDisplay && this.cfg.show_bitrate && this.currentBitrate > 0) {
                    bitrateDisplay.textContent = this.formatBitrateWithUnits(this.currentBitrate);
                }
                
                if (progressBar && !this.isDragging) {
                    if (audio.duration && isFinite(audio.duration)) {
                        progressBar.value = (audio.currentTime / audio.duration) * 10000;
                        progressBar.disabled = false;
                    } else {
                        progressBar.value = 0;
                        progressBar.disabled = true;
                    }
                }
            };
            
            if (wasPlaying) {
                await audio.play();
            }
        } catch (e) {
            audio.src = this.currentPlayingUri;
            audio.currentTime = currentTime;
            audio.volume = currentVolume;
            if (wasPlaying) {
                await audio.play();
            }
            throw e;
        }
    },

    async checkCachedVersion(originalUri) {
        if (!this.cfg.enable_lossless_and_cache) return null;
        
        try {
            const decodedUri = decodeURIComponent(originalUri);
            const fileName = decodedUri.split('/').pop();
            const baseName = fileName.replace(/\.[^/.]+$/, "");
            
            const baseUri = originalUri.replace(/\/[^/]+$/, '');
            
            const flacUri = `${baseUri}/cache/${encodeURIComponent(baseName)}.flac`;
            const flacExists = await this.checkFileExists(flacUri);
            if (flacExists) return { cachedUri: flacUri, originalUri };
            
            const wavUri = `${baseUri}/cache/${encodeURIComponent(baseName)}.wav`;
            const wavExists = await this.checkFileExists(wavUri);
            if (wavExists) return { cachedUri: wavUri, originalUri };
            
            return null;
        } catch (e) {
            return null;
        }
    },

    async checkFileExists(uri) {
        try {
            const res = await fetch(uri, { method: 'HEAD' });
            return res.ok;
        } catch {
            return false;
        }
    },

    showError(message) {
        const title = document.querySelector('.mmp-title');
        if (title) {
            title.textContent = `[ERR] ${this.currentPlayingName}: ${message}`;
            title.style.color = 'var(--bad)';
            setTimeout(() => {
                if (title) title.style.color = '';
            }, 5000);
        }
    },

    updateLoadingProgress(percent) {
        const loadingIndicator = document.querySelector('.mmp-loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.width = `${percent}%`;
            loadingIndicator.style.display = percent > 0 && percent < 100 ? 'block' : 'none';
        }
    },

    setupAudioBindings() {
        const audio = this.audioElement;
        if (!audio) return;

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            const playerVisible = document.getElementById('mmp-audio')?.style.display === 'flex';
            const isPlaying = this.isPlaying;
            
            switch(e.key) {
                case ' ':
                    if (playerVisible) {
                        e.preventDefault();
                        this.togglePlay();
                    }
                    break;
                case 'ArrowRight':
                    if (playerVisible && isPlaying) {
                        if (e.ctrlKey) {
                            if (audio.duration && isFinite(audio.duration) && !this.isTranscoded) {
                                audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
                            }
                        } else {
                            setTimeout(() => this.playNext(), 300);
                        }
                    }
                    break;
                case 'ArrowLeft':
                    if (playerVisible && isPlaying) {
                        if (e.ctrlKey) {
                            if (audio.duration && isFinite(audio.duration) && !this.isTranscoded) {
                                audio.currentTime = Math.max(0, audio.currentTime - 5);
                            }
                        } else {
                            setTimeout(() => this.playPrev(), 300);
                        }
                    }
                    break;
                case 'ArrowUp':
                    if (playerVisible) this.adjustVolume(1);
                    break;
                case 'ArrowDown':
                    if (playerVisible) this.adjustVolume(-1);
                    break;
                case 'Escape':
                    if (playerVisible) this.stop();
                    break;
            }
        });
    },

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    },

    playNext() {
        if (!this.playlist.length) return;
        
        if (this.cfg.loop_mode === 'none' && this.index >= this.playlist.length - 1) {
            this.stop();
            return;
        }
        
        if (this.shuffleEnabled) {
            this.index = this.getNextShuffleIndex();
        } else {
            this.index = (this.index + 1) % this.playlist.length;
        }
        
        this.play(this.playlist[this.index]);
    },

    playPrev() {
        if (!this.playlist.length) return;
        
        if (this.cfg.loop_mode === 'none' && this.index <= 0) {
            this.stop();
            return;
        }
        
        if (this.shuffleEnabled) {
            let prevIndex;
            do {
                prevIndex = Math.floor(Math.random() * this.playlist.length);
            } while (prevIndex === this.index && this.playlist.length > 1);
            this.index = prevIndex;
        } else {
            this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
        }
        
        this.play(this.playlist[this.index]);
    },

    togglePlay() {
        const audio = this.audioElement;
        if (!audio) return;

        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    },

    pause() {
        const audio = this.audioElement;
        if (!audio) return;
        audio.pause();
    },

    adjustVolume(change) {
        const audio = this.audioElement;
        if (!audio) return;
        
        let newVol = Math.round(audio.volume * 100) + change;
        newVol = Math.max(0, Math.min(100, newVol)) / 100;
        
        audio.volume = newVol;
        this.cfg.audio_vol = newVol;
        localStorage.setItem('mmp_volume', newVol.toString());
        
        const volDisplay = document.querySelector('.mmp-volume-value');
        if (volDisplay) volDisplay.textContent = `${Math.round(newVol * 100)}%`;
    },

    stop() {
        const root = document.getElementById('mmp-audio');
        if (!root) return;

        const title = root.querySelector('.mmp-title');
        if (title && title.textContent && title.textContent.includes('Scanning')) {
            console.log('Preventing stop() during scanning');
            return;
        }

        if (this.cacheProbeInterval) {
            clearInterval(this.cacheProbeInterval);
            this.cacheProbeInterval = null;
        }

        const audio = this.audioElement;
        const bitrateDisplay = root.querySelector('.mmp-bitrate');

        root.style.display = 'none';
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        if (title) {
            title.innerText = '';
            title.style.color = '';
        }
        if (bitrateDisplay) {
            bitrateDisplay.textContent = '';
        }
        this.isPlaying = false;
        this.isDragging = false;
        this.ffmpegAttempted = false;
        this.isTranscoded = false;
        this.loadedFromCache = false;
        this.currentPlayingUri = '';
        this.currentPlayingName = '';
    },

    // ========== 清理资源 ==========
    dispose() {
        this.cleanupPreactHijacker();
        if (this._hijackObserver) {
            this._hijackObserver.disconnect();
            this._hijackObserver = null;
        }
        if (this._hijackTimeoutId) {
            clearTimeout(this._hijackTimeoutId);
            this._hijackTimeoutId = null;
        }
        console.log('MMP: Resources cleaned up');
    }
}

MMP.init();

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    MMP.dispose();
});