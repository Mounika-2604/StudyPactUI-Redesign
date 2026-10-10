import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    HelpCircle,
    Paperclip,
    Send,
    MessageSquare,
    CheckCircle2,
    Clock,
    X,
    Image as ImageIcon,
    Shield,
    Sparkles,
    Search,
    BookOpen
} from 'lucide-react';
import {
    createDoubt,
    createDoubtReply,
    getDoubts,
    uploadDoubtImages,
} from '../../services/doubtService';
import { supabase } from '../../services/supabaseClient';
import './Doubtforum.css';

const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
]);

const QUICK_QUERY_TOPICS = [
    'Syllabus Interpretation',
    'PYQ Derivation',
    'Formula Clarification',
    'Ethics Case Analysis',
];

const readImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
        data: String(reader.result).split(',')[1],
        mimeType: file.type,
    });
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
});

const formatDoubt = (doubt) => ({
    id: doubt.id,
    author: doubt.authorName || 'Scholar',
    text: doubt.content,
    images: doubt.images || [],
    createdAt: doubt.createdAt,
    replies: (doubt.replies || []).map((reply) => ({
        id: reply.id,
        author: reply.authorName || 'Scholar',
        text: reply.content,
        createdAt: reply.createdAt,
    })),
});

const DoubtForum = () => {
    const { id } = useParams();

    const [doubts, setDoubts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [realtimeError, setRealtimeError] = useState('');
    const [draftText, setDraftText] = useState('');
    const [draftImages, setDraftImages] = useState([]);
    const [posting, setPosting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [replyingId, setReplyingId] = useState(null);
    const [postError, setPostError] = useState('');
    const [replyDrafts, setReplyDrafts] = useState({});
    const [openReplyId, setOpenReplyId] = useState(null);
    const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'unanswered' | 'with_images'
    const [activeLightboxImg, setActiveLightboxImg] = useState(null);
    const realtimeRetryTimerRef = useRef(null);
    const realtimeRetryCountRef = useRef(0);

    useEffect(() => {
        let isCurrent = true;
        let channel = null;

        const replaceDoubtFromServer = async (doubtId) => {
            try {
                const fetchedDoubts = await getDoubts(id);
                if (!isCurrent) return;

                const formattedDoubts = fetchedDoubts.map(formatDoubt);
                if (doubtId && !formattedDoubts.some((doubt) => doubt.id === doubtId)) {
                    return;
                }

                setDoubts(formattedDoubts);
                setRealtimeError('');
            } catch (error) {
                if (isCurrent) {
                    setRealtimeError(error.message || 'Unable to resynchronize forum updates.');
                }
            }
        };

        const subscribeToDoubtUpdates = () => {
            if (!isCurrent) return;
            if (!supabase) {
                setRealtimeError('Realtime is not configured for this environment.');
                return;
            }

            const subscribedChannel = supabase
                .channel(`doubt-forum:${id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'doubts',
                        filter: `room_id=eq.${id}`,
                    },
                    ({ new: newDoubt }) => {
                        if (!newDoubt?.id) return;
                        void replaceDoubtFromServer(newDoubt.id);
                    },
                )
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'doubt_replies',
                    },
                    ({ new: newReply }) => {
                        if (!newReply?.id || !newReply.doubt_id) return;
                        void replaceDoubtFromServer(newReply.doubt_id);
                    },
                );

            channel = subscribedChannel;
            subscribedChannel.subscribe((status) => {
                if (!isCurrent) return;

                if (status === 'SUBSCRIBED') {
                    return;
                }

                if (
                    status !== 'CHANNEL_ERROR' &&
                    status !== 'TIMED_OUT' &&
                    status !== 'CLOSED'
                ) {
                    return;
                }

                if (
                    realtimeRetryCountRef.current >= 3 ||
                    realtimeRetryTimerRef.current
                ) return;
                realtimeRetryCountRef.current += 1;
                const retryDelay = realtimeRetryCountRef.current * 1000;
                realtimeRetryTimerRef.current = window.setTimeout(async () => {
                    realtimeRetryTimerRef.current = null;
                    if (!isCurrent) return;
                    await supabase.removeChannel(subscribedChannel);
                    await replaceDoubtFromServer();
                    subscribeToDoubtUpdates();
                }, retryDelay);
            });
        };

        const loadDoubts = async () => {
            setLoading(true);
            setLoadError('');

            try {
                const fetchedDoubts = await getDoubts(id);
                if (!isCurrent) return;

                setDoubts(fetchedDoubts.map(formatDoubt));
                setRealtimeError('');
                subscribeToDoubtUpdates();
            } catch (error) {
                if (isCurrent) {
                    setLoadError(error.message || 'Unable to load doubts.');
                }
            } finally {
                if (isCurrent) {
                    setLoading(false);
                }
            }
        };

        void loadDoubts();

        return () => {
            isCurrent = false;
            if (realtimeRetryTimerRef.current) {
                window.clearTimeout(realtimeRetryTimerRef.current);
            }
            realtimeRetryTimerRef.current = null;
            realtimeRetryCountRef.current = 0;
            if (channel) {
                void supabase?.removeChannel(channel);
            }
        };
    }, [id]);

    const handlePostDoubt = async (e) => {
        e.preventDefault();
        const content = draftText.trim();
        if (!content || posting) return;

        setPosting(true);
        setPostError('');

        try {
            const doubt = await createDoubt(id, content);
            let images = [];
            if (draftImages.length > 0) {
                setUploading(true);
                const imagePayloads = await Promise.all(draftImages.map(readImage));
                images = await uploadDoubtImages(id, doubt.id, imagePayloads);
            }
            setDoubts((prev) => [{
                id: doubt.id,
                author: 'You',
                text: doubt.content,
                images,
                createdAt: 'just now',
                replies: [],
            }, ...prev]);
            setDraftText('');
            setDraftImages([]);
        } catch (error) {
            setPostError(error.message || 'Unable to post your doubt.');
        } finally {
            setUploading(false);
            setPosting(false);
        }
    };

    const handleImageChange = (event) => {
        const selectedFiles = Array.from(event.target.files || []);
        if (!selectedFiles.length) return;

        if (selectedFiles.length > MAX_IMAGE_COUNT) {
            setPostError(`You can attach up to ${MAX_IMAGE_COUNT} images.`);
            event.target.value = '';
            return;
        }

        const invalidFile = selectedFiles.find((file) => (
            !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES
        ));
        if (invalidFile) {
            setPostError('Images must be JPEG, PNG, WebP, or GIF files of 3 MB or less.');
            event.target.value = '';
            return;
        }

        setPostError('');
        setDraftImages(selectedFiles);
    };

    const handleReplySubmit = async (doubtId) => {
        const text = (replyDrafts[doubtId] || '').trim();
        const doubt = doubts.find((item) => item.id === doubtId);
        if (!text || !doubt || replyingId === doubtId) return;

        setReplyingId(doubtId);
        setPostError('');

        try {
            const reply = await createDoubtReply(id, doubtId, text);
            const formattedReply = {
                id: reply.id,
                author: reply.authorName || 'Scholar',
                text: reply.content,
                createdAt: reply.createdAt,
            };
            setDoubts((prev) =>
                prev.map((d) =>
                    d.id === doubtId
                        ? { ...d, replies: [...d.replies, formattedReply] }
                        : d
                )
            );
            setReplyDrafts((prev) => ({ ...prev, [doubtId]: '' }));
            setOpenReplyId(null);
        } catch (error) {
            setPostError(error.message || 'Unable to post your reply.');
        } finally {
            setReplyingId(null);
        }
    };

    const filteredDoubts = doubts.filter((d) => {
        if (activeFilter === 'unanswered') return d.replies.length === 0;
        if (activeFilter === 'with_images') return d.images && d.images.length > 0;
        return true;
    });

    return (
        <div className="sp-tribunal-page">
            {/* ================================================================
                TOP TRIBUNAL COCKPIT BAR
                ================================================================ */}
            <header className="sp-tribunal-bar">
                <div className="sp-tribunal-bar-left">
                    <Link to={`/study-room/${id}`} className="sp-tribunal-back-btn">
                        <ArrowLeft size={16} />
                        <span>Return to Chamber</span>
                    </Link>
                    <div className="sp-tribunal-chamber-tag">
                        CHAMBER #{id?.slice(0, 8) || 'MAIN'}
                    </div>
                </div>

                <div className="sp-tribunal-bar-center">
                    <span className="sp-tribunal-seal">§</span>
                    <div>
                        <h1 className="sp-tribunal-title">Academic Inquiry Tribunal</h1>
                        <span className="sp-tribunal-sub">Concept Scrutiny & Peer Resolution</span>
                    </div>
                </div>

                <div className="sp-tribunal-bar-right">
                    <div className="sp-tribunal-metric-badge">
                        <MessageSquare size={13} />
                        <span>{doubts.length} Inquiries Filed</span>
                    </div>
                </div>
            </header>

            {/* ================================================================
                DUAL-WING TRIBUNAL WORKSPACE
                ================================================================ */}
            <div className="sp-tribunal-workspace">
                {/* ============================================================
                    LEFT WING: LODGING STUDIO & CANONS (~380px STICKY)
                    ============================================================ */}
                <aside className="sp-tribunal-left-wing">
                    {/* Inquiry Submission Box */}
                    <div className="sp-inquiry-box">
                        <div className="sp-inquiry-header">
                            <span className="sp-inquiry-eyebrow">ARTICLE IX · PETITION</span>
                            <h3 className="sp-inquiry-title">Lodge Scholarly Inquiry</h3>
                            <p className="sp-inquiry-sub">
                                Submit specific doubts, derivations, or problem sets for peer dissection.
                            </p>
                        </div>

                        {postError && (
                            <div className="sp-notice sp-notice-alert sp-inquiry-notice" role="alert">
                                {postError}
                            </div>
                        )}

                        <form className="sp-inquiry-form" onSubmit={handlePostDoubt}>
                            <textarea
                                id="doubt-text"
                                className="sp-inquiry-textarea"
                                placeholder="Describe the conceptual impasse, state the question source (PYQ/mock), and detail your attempt..."
                                value={draftText}
                                onChange={(e) => setDraftText(e.target.value)}
                                rows={4}
                                maxLength={5000}
                                disabled={posting}
                            />

                            {/* Image Attachment Dropzone */}
                            <div className="sp-attachment-area">
                                <label className={`sp-attach-trigger ${posting ? 'disabled' : ''}`}>
                                    <Paperclip size={14} />
                                    <span>
                                        {draftImages.length
                                            ? `${draftImages.length} of ${MAX_IMAGE_COUNT} Diagram(s) Attached`
                                            : 'Attach Problem Sheet / Diagram (Max 3)'}
                                    </span>
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,image/gif"
                                        multiple
                                        onChange={handleImageChange}
                                        disabled={posting}
                                        hidden
                                    />
                                </label>

                                {draftImages.length > 0 && (
                                    <div className="sp-attached-chips">
                                        {draftImages.map((file) => (
                                            <span
                                                key={`${file.name}-${file.lastModified}`}
                                                className="sp-attached-chip"
                                            >
                                                <ImageIcon size={11} />
                                                <span className="sp-chip-name">{file.name}</span>
                                                <button
                                                    type="button"
                                                    className="sp-chip-remove"
                                                    aria-label={`Remove ${file.name}`}
                                                    onClick={() =>
                                                        setDraftImages((current) =>
                                                            current.filter((item) => item !== file)
                                                        )
                                                    }
                                                    disabled={posting}
                                                >
                                                    <X size={11} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Quick Topic Helpers */}
                            <div className="sp-quick-topics">
                                <span className="sp-quick-label">Subject tags:</span>
                                <div className="sp-quick-tag-row">
                                    {QUICK_QUERY_TOPICS.map((topic) => (
                                        <button
                                            type="button"
                                            key={topic}
                                            className="sp-quick-tag"
                                            onClick={() => setDraftText((prev) => prev ? `${prev} [${topic}] ` : `[${topic}] `)}
                                        >
                                            + {topic}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="sp-btn sp-btn-primary sp-submit-inquiry-btn"
                                disabled={posting || !draftText.trim()}
                            >
                                <Send size={14} />
                                <span>{uploading ? 'Uploading Diagrams...' : posting ? 'Lodging Query...' : 'Lodge Inquiry to Chamber'}</span>
                            </button>
                        </form>
                    </div>

                    {/* Canons & Guidelines Box */}
                    <div className="sp-canons-box">
                        <div className="sp-canons-header">
                            <Shield size={16} className="sp-canons-icon" />
                            <h4 className="sp-canons-title">Tribunal Disputation Code</h4>
                        </div>
                        <ul className="sp-canons-list">
                            <li>
                                <strong>Canon I:</strong> State the exact proposition or source paper.
                            </li>
                            <li>
                                <strong>Canon II:</strong> Reveal your prior attempt to isolate the misunderstanding.
                            </li>
                            <li>
                                <strong>Canon III:</strong> Confirm solutions that withstand examination logic.
                            </li>
                        </ul>
                    </div>
                </aside>

                {/* ============================================================
                    RIGHT WING: THE INQUIRY DOCKET & RESOLUTION STREAM (FLUID)
                    ============================================================ */}
                <main className="sp-tribunal-docket">
                    {/* Docket Header & Filter Bar */}
                    <div className="sp-docket-toolbar">
                        <div className="sp-docket-tabs">
                            <button
                                type="button"
                                className={`sp-docket-tab ${activeFilter === 'all' ? 'active' : ''}`}
                                onClick={() => setActiveFilter('all')}
                            >
                                All Inquiries ({doubts.length})
                            </button>
                            <button
                                type="button"
                                className={`sp-docket-tab ${activeFilter === 'unanswered' ? 'active' : ''}`}
                                onClick={() => setActiveFilter('unanswered')}
                            >
                                Awaiting Solution ({doubts.filter(d => d.replies.length === 0).length})
                            </button>
                            <button
                                type="button"
                                className={`sp-docket-tab ${activeFilter === 'with_images' ? 'active' : ''}`}
                                onClick={() => setActiveFilter('with_images')}
                            >
                                With Diagrams ({doubts.filter(d => d.images?.length > 0).length})
                            </button>
                        </div>
                    </div>

                    {loading && (
                        <div className="sp-docket-loading">
                            <div className="sp-spinner"></div>
                            <span>Retrieving chamber dispute records...</span>
                        </div>
                    )}

                    {loadError && (
                        <div className="sp-notice sp-notice-alert" role="alert">
                            {loadError}
                        </div>
                    )}

                    {realtimeError && (
                        <div className="sp-notice sp-notice-info" role="status">
                            {realtimeError}
                        </div>
                    )}

                    {!loading && !loadError && (
                        <div className="sp-docket-feed">
                            {filteredDoubts.map((doubt, idx) => {
                                const hasReplies = doubt.replies.length > 0;
                                const isReplying = openReplyId === doubt.id;

                                return (
                                    <article key={doubt.id} className="sp-query-dossier">
                                        {/* Query Dossier Header */}
                                        <div className="sp-query-header">
                                            <div className="sp-query-author-block">
                                                <div className="sp-query-avatar">
                                                    {doubt.author.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="sp-query-author-meta">
                                                    <span className="sp-query-author-name">{doubt.author}</span>
                                                    <span className="sp-query-time">
                                                        <Clock size={11} /> {doubt.createdAt}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="sp-query-status-badge">
                                                <span className="sp-query-serial">CASE #{String(idx + 1).padStart(2, '0')}</span>
                                                <span className={`sp-status-tag ${hasReplies ? 'resolved' : 'pending'}`}>
                                                    {hasReplies ? 'UNDER DISCUSSION' : 'OPEN FOR SCRUTINY'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Query Main Body */}
                                        <p className="sp-query-text">{doubt.text}</p>

                                        {/* Attached Diagrams Gallery */}
                                        {doubt.images?.length > 0 && (
                                            <div className="sp-query-gallery">
                                                {doubt.images.map((image, imgIdx) => (
                                                    <div
                                                        key={image.id || imgIdx}
                                                        className="sp-gallery-thumb-wrap"
                                                        onClick={() => setActiveLightboxImg(image.url)}
                                                        title="Click to examine full diagram"
                                                    >
                                                        <img
                                                            src={image.url}
                                                            alt="Attached problem diagram"
                                                            className="sp-gallery-thumb"
                                                        />
                                                        <span className="sp-gallery-zoom-hint">Inspect ↗</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Query Footer & Reply Toggle */}
                                        <div className="sp-query-footer">
                                            <button
                                                type="button"
                                                className="sp-replies-counter-btn"
                                                onClick={() => setOpenReplyId(isReplying ? null : doubt.id)}
                                            >
                                                <MessageSquare size={14} />
                                                <span>
                                                    {doubt.replies.length} {doubt.replies.length === 1 ? 'Scholar Response' : 'Scholar Responses'}
                                                </span>
                                                <span className="sp-counter-action">
                                                    {isReplying ? 'Collapse ↑' : 'Contribute Resolution ↓'}
                                                </span>
                                            </button>
                                        </div>

                                        {/* Discussion / Responses Feed */}
                                        {doubt.replies.length > 0 && (
                                            <div className="sp-responses-feed">
                                                {doubt.replies.map((reply, rIdx) => (
                                                    <div key={reply.id || rIdx} className="sp-response-card">
                                                        <div className="sp-response-avatar">
                                                            {reply.author.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="sp-response-content">
                                                            <div className="sp-response-meta">
                                                                <span className="sp-response-author">{reply.author}</span>
                                                                <span className="sp-response-time">{reply.createdAt}</span>
                                                            </div>
                                                            <p className="sp-response-text">{reply.text}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Inline Resolution Composer */}
                                        {isReplying && (
                                            <div className="sp-inline-reply-tray">
                                                <input
                                                    type="text"
                                                    className="sp-inline-reply-input"
                                                    placeholder="Formulate constructive derivation or solution..."
                                                    value={replyDrafts[doubt.id] || ''}
                                                    onChange={(e) =>
                                                        setReplyDrafts((prev) => ({ ...prev, [doubt.id]: e.target.value }))
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') void handleReplySubmit(doubt.id);
                                                    }}
                                                    disabled={replyingId === doubt.id}
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    className="sp-btn sp-btn-primary sp-btn-sm"
                                                    onClick={() => void handleReplySubmit(doubt.id)}
                                                    disabled={replyingId === doubt.id || !(replyDrafts[doubt.id] || '').trim()}
                                                >
                                                    {replyingId === doubt.id ? 'Submitting...' : 'Post Solution'}
                                                </button>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}

                            {filteredDoubts.length === 0 && (
                                <div className="sp-docket-empty">
                                    <div className="sp-empty-case-monogram">§</div>
                                    <h3 className="sp-empty-case-title">The Tribunal Docket is Clear</h3>
                                    <p className="sp-empty-case-sub">
                                        No academic impasses registered for this chamber filter. Lodge the first question in the studio on the left.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>

            {/* Lightbox Modal */}
            {activeLightboxImg && (
                <div className="sp-lightbox-overlay" onClick={() => setActiveLightboxImg(null)}>
                    <div className="sp-lightbox-container" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="sp-lightbox-close"
                            onClick={() => setActiveLightboxImg(null)}
                            aria-label="Close diagram"
                        >
                            <X size={20} />
                        </button>
                        <img src={activeLightboxImg} alt="Magnified diagram" className="sp-lightbox-img" />
                    </div>
                </div>
            )}
        </div>
    );
};

export default DoubtForum;
