"use strict";
{
    const { React, h, toast } = HFS;
    const cfg = HFS.getPluginConfig();
    const exts = cfg.extensions?.toLowerCase().split(',').map(x => x.trim());
    const audioExts = ['aiff','aif','alac','dsd','dsf','dff','ape','flac','wav'];
    const problematicFormats = ['wmv','avi','mpg','ts','rmvb','rm','vob','dat','flv'];

    class VideoResourceManager {
        constructor(video) {
            this.video = video;
            this.currentSrc = '';
            this.cleanupCallbacks = [];
            this.userInteracted = false;
        }

        setSource(src) {
            if (this.currentSrc === src) return false;
            this.currentSrc = src;
            this.video.src = src;
            return true;
        }

        addCleanup(callback) {
            this.cleanupCallbacks.push(callback);
        }

        cleanup() {
            this.cleanupCallbacks.forEach(cb => cb());
            this.video.removeAttribute('src');
            this.video.load();
            this.currentSrc = '';
        }

        handleUserInteraction() {
            this.userInteracted = true;
            // Try to play if we were waiting for interaction
            this.video.play().catch(e => console.debug('Play after interaction failed:', e));
        }
    }

    // 使用新的 HFS.onEvent 架构
    HFS.onEvent('fileShow', params => {
        if (!exts.includes(params.entry.ext)) return;
        
        const { Component } = params; // 保存原始组件供嵌入使用
        
        // 音频处理
        if (audioExts.includes(params.entry.ext)) {
            params.Component = HFS.markVideoComponent(React.forwardRef((props, ref) => {
                const [convert, setConvert] = React.useState(false);
                
                React.useEffect(() => {
                    setConvert(false);
                    if (ref?.current) {
                        ref.current.src = props.src;
                    }
                }, [props.src]);

                React.useEffect(() => {
                    const el = ref?.current;
                    if (!el) return;
                    
                    const handleError = () => {
                        if (!el.error || el.error.code < 3) return;
                        
                        // 特别处理MP3文件 - 不进行转码但允许封面提取
                        if (props.src.toLowerCase().endsWith('.mp3')) {
                            toast("MP3播放失败", 'error');
                            return;
                        }
                        
                        if (convert) {
                            toast("音频转换失败", 'error');
                        } else {
                            setConvert(true);
                            toast("不支持的音频格式，尝试转换", 'info');
                        }
                    };
                    
                    el.addEventListener('error', handleError);
                    return () => el.removeEventListener('error', handleError);
                }, [convert, props.src]);

                return h(Component || 'audio', {
                    ...props,
                    ref,
                    controls: true,
                    src: props.src + (convert && !props.src.toLowerCase().endsWith('.mp3') ? '?ffmpeg&t=' + Date.now() : ''),
                    onError: props.onError
                });
            }));
            return;
        }
        
        // 视频处理
        params.Component = HFS.markVideoComponent(React.forwardRef((props, ref) => {
            const [convert, setConvert] = React.useState(false);
            const [retryCount, setRetryCount] = React.useState(0);
            const resourceManager = React.useRef();
            const ext = props.src.split('.').pop().toLowerCase();

            // 清理效果
            React.useEffect(() => {
                const was = ref?.current;
                return () => {
                    resourceManager.current?.cleanup();
                    // DOM 清理技巧
                    if (was && !ref?.current) {
                        was.removeAttribute('src');
                        was.load();
                    }
                };
            }, []);

            React.useEffect(() => {
                const video = ref?.current;
                if (!video) return;

                if (!resourceManager.current) {
                    resourceManager.current = new VideoResourceManager(video);
                    
                    // Add click handler for user interaction
                    const handleClick = () => resourceManager.current.handleUserInteraction();
                    video.addEventListener('click', handleClick);
                    resourceManager.current.addCleanup(() => 
                        video.removeEventListener('click', handleClick)
                    );
                }

                // Reset state when source changes
                setConvert(problematicFormats.includes(ext));
                setRetryCount(0);
                
                const handleError = () => {
                    if (!video.error || video.error.code < 3) return;

                    if (convert) {
                        if (retryCount < 2) {
                            setRetryCount(c => {
                                const newCount = c + 1;
                                setTimeout(() => {
                                    if (ref?.current) {
                                        const newSrc = props.src + '?ffmpeg&retry=' + newCount + '&t=' + Date.now();
                                        if (resourceManager.current.setSource(newSrc)) {
                                            ref.current.load();
                                        }
                                    }
                                }, 1000 * newCount);
                                return newCount;
                            });
                        } else {
                            toast("视频播放失败，重试次数已达上限", 'error');
                        }
                    } else {
                        setConvert(true);
                        setRetryCount(0);
                        const newSrc = props.src + '?ffmpeg&t=' + Date.now();
                        if (resourceManager.current.setSource(newSrc)) {
                            video.load();
                        }
                    }
                };

                const handleLoadedMetadata = () => {
                    if (video.videoWidth === 0 || video.videoHeight === 0) {
                        handleError();
                    }
                };

                const handleCanPlay = () => {
                    // Only autoplay if it's a direct source (not transcoded) or user has interacted
                    if (!convert || resourceManager.current.userInteracted) {
                        video.play().catch(e => console.debug('Autoplay failed:', e));
                    }
                };

                video.addEventListener('error', handleError);
                video.addEventListener('loadedmetadata', handleLoadedMetadata);
                video.addEventListener('canplay', handleCanPlay);
                
                resourceManager.current.addCleanup(() => {
                    video.removeEventListener('error', handleError);
                    video.removeEventListener('loadedmetadata', handleLoadedMetadata);
                    video.removeEventListener('canplay', handleCanPlay);
                });

                // Set initial source - force transcoding for problematic formats
                const initialSrc = problematicFormats.includes(ext) 
                    ? props.src + '?ffmpeg&t=' + Date.now() 
                    : props.src;
                    
                resourceManager.current.setSource(initialSrc);

            }, [props.src, convert, retryCount, ext]);

            return h(Component || HFS.fileShowComponents?.Video || 'video', {
                ...props,
                ref,
                controls: true,
                onError: props.onError,
                preload: 'auto',
                crossOrigin: 'anonymous',
                muted: false
            });
        }));
    });
}