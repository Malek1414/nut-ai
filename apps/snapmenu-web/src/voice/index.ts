/**
 * Voice messages and the menu chat.
 *
 *   <MenuChat result={result} />            "Ask about this menu", under the scan results
 *   <VoiceRecorder onTranscript={...} />    the hold-to-record microphone, for any text field
 *   <InterviewVoice language onHeard />     the interview, answered by voice
 */
export { MenuChat, type MenuChatProps } from './MenuChat'
export { VoiceRecorder, type HeardClip, type VoiceClip, type VoiceFailure, type VoiceRecorderProps } from './VoiceRecorder'
export { InterviewVoice } from './InterviewVoice'
export { canSpeak, speak } from './speak'
