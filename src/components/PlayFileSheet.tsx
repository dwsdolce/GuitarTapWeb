import { useRef, useState } from 'react'

export interface PlayFileSheetProps {
  /** Play the chosen audio file through the live pipeline, with an optional calibration. */
  onPlay: (audio: File, calibration: File | null) => void
  onClose: () => void
}

/** Pick an audio file (+ optional mic calibration) to replay through the live analysis pipeline.
 *  Mirrors Swift PlayFileSheet: audio required, calibration optional ("the calibration that was
 *  active when the recording was made"). */
export function PlayFileSheet({ onPlay, onClose }: PlayFileSheetProps) {
  const [audio, setAudio] = useState<File | null>(null)
  const [calibration, setCalibration] = useState<File | null>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const calInput = useRef<HTMLInputElement>(null)

  const play = () => {
    if (!audio) return
    onPlay(audio, calibration)
    onClose()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-label="Play Audio File" onClick={onClose}>
      <div className="settings-modal save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Play Audio File</h2>
          <div className="set-head-buttons">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={play} disabled={!audio}>
              Play
            </button>
          </div>
        </div>
        <div className="settings-body">
          <div className="set-field">
            <span>Audio File</span>
            <span className="playfile-pick">
              <span className="playfile-name">{audio?.name ?? 'No file selected'}</span>
              <button className="btn mini" onClick={() => audioInput.current?.click()}>
                Browse…
              </button>
            </span>
            <input
              ref={audioInput}
              type="file"
              accept=".wav,audio/wav,audio/x-wav"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) setAudio(f)
              }}
            />
          </div>

          <div className="set-field">
            <span>Calibration (optional)</span>
            <span className="playfile-pick">
              <span className="playfile-name">{calibration?.name ?? 'None'}</span>
              {calibration && (
                <button className="btn mini" onClick={() => setCalibration(null)}>
                  Clear
                </button>
              )}
              <button className="btn mini" onClick={() => calInput.current?.click()}>
                Browse…
              </button>
            </span>
            <input
              ref={calInput}
              type="file"
              accept=".cal,.txt,text/plain"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) setCalibration(f)
              }}
            />
          </div>

          <p className="set-note">
            The file is played through the same tap-detection + FFT pipeline as the live mic. Provide
            the calibration that was active when the recording was made for accurate magnitudes.
          </p>
        </div>
      </div>
    </div>
  )
}