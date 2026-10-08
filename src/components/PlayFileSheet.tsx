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
        </div>
        {/* Swift's PlayFileSheet: a bold title above each row; the file's name (secondary while there is
            none) with Browse… at the right, and Clear once a calibration is chosen; the hint under the
            calibration; Cancel and Play at the bottom right, as Save's. */}
        <div className="settings-body">
          <div className="form-field">
            <span className="form-label">Audio File</span>
            <span className="form-file-row">
              <span className={`form-file-name${audio ? '' : ' none'}`}>{audio?.name ?? 'No file selected'}</span>
              <button className="btn" onClick={() => audioInput.current?.click()}>
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

          <div className="form-field">
            <span className="form-label">Calibration File (Optional)</span>
            <span className="form-file-row">
              <span className={`form-file-name${calibration ? '' : ' none'}`}>{calibration?.name ?? 'None'}</span>
              {calibration && (
                <button className="btn" onClick={() => setCalibration(null)}>
                  Clear
                </button>
              )}
              <button className="btn" onClick={() => calInput.current?.click()}>
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
            <span className="form-caption">Select the calibration file that was active when the recording was made</span>
          </div>
        </div>
        <div className="settings-modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {/* Play commits — the accent while there is a file, a plain button until then. */}
          <button className={`btn${audio ? ' btn-primary' : ''}`} onClick={play} disabled={!audio}>
            Play
          </button>
        </div>
      </div>
    </div>
  )
}