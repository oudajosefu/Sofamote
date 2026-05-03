import type { ReactNode } from "react";
import { useSettings } from "./SettingsContext";
import type { InterfaceName } from "./types";

interface Props {
  onClose: () => void;
}

const INTERFACE_OPTIONS: { value: InterfaceName; label: string }[] = [
  { value: "media", label: "Media Remote" },
  { value: "fullControl", label: "Full Control" },
  { value: "trackpad", label: "Trackpad" },
];

export function SettingsUI({ onClose }: Props) {
  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <div className="settings-ui">
      <div className="settings-section">
        <div className="settings-section-label">General</div>

        <Row label="Default interface" hint="Loads when the app opens">
          <select
            className="settings-select"
            value={settings.defaultInterface}
            onChange={(e) =>
              updateSettings({ defaultInterface: e.target.value as InterfaceName })
            }
          >
            {INTERFACE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Haptic feedback" hint="Vibrate on button taps and gestures">
          <Toggle
            checked={settings.hapticFeedback}
            onChange={(v) => updateSettings({ hapticFeedback: v })}
          />
        </Row>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Trackpad</div>

        <SliderRow
          label="Mouse speed"
          value={settings.trackpadMoveSensitivity}
          min={0.1}
          max={5}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => updateSettings({ trackpadMoveSensitivity: v })}
        />

        <SliderRow
          label="Scroll speed"
          value={settings.trackpadScrollSensitivity}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => updateSettings({ trackpadScrollSensitivity: v })}
        />

        <Row label="Natural scrolling" hint="Content moves with finger direction">
          <Toggle
            checked={settings.trackpadScrollNatural}
            onChange={(v) => updateSettings({ trackpadScrollNatural: v })}
          />
        </Row>

        <SliderRow
          label="Tap max duration"
          value={settings.trackpadTapMaxDurationMs}
          min={50}
          max={500}
          step={10}
          format={(v) => `${v} ms`}
          onChange={(v) => updateSettings({ trackpadTapMaxDurationMs: v })}
        />

        <SliderRow
          label="Tap max movement"
          value={settings.trackpadTapMaxMovement}
          min={1}
          max={20}
          step={1}
          format={(v) => `${v} px`}
          onChange={(v) => updateSettings({ trackpadTapMaxMovement: v })}
        />

        <SliderRow
          label="Double-tap window"
          value={settings.trackpadDoubleTapWindowMs}
          min={100}
          max={600}
          step={10}
          format={(v) => `${v} ms`}
          onChange={(v) => updateSettings({ trackpadDoubleTapWindowMs: v })}
        />

        <SliderRow
          label="Double-tap max distance"
          value={settings.trackpadDoubleTapMaxDistance}
          min={5}
          max={100}
          step={5}
          format={(v) => `${v} px`}
          onChange={(v) => updateSettings({ trackpadDoubleTapMaxDistance: v })}
        />

        <SliderRow
          label="Two-finger tap max duration"
          value={settings.trackpadTwoFingerTapMaxDurationMs}
          min={50}
          max={500}
          step={10}
          format={(v) => `${v} ms`}
          onChange={(v) => updateSettings({ trackpadTwoFingerTapMaxDurationMs: v })}
        />

        <SliderRow
          label="Two-finger tap max movement"
          value={settings.trackpadTwoFingerTapMaxMovement}
          min={1}
          max={30}
          step={1}
          format={(v) => `${v} px`}
          onChange={(v) => updateSettings({ trackpadTwoFingerTapMaxMovement: v })}
        />
      </div>

      <div className="settings-footer">
        <button className="btn small" onClick={resetSettings}>
          <span className="btn-main">Reset to defaults</span>
        </button>
        <button className="btn small primary-action" onClick={onClose}>
          <span className="btn-main">Done</span>
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <div className="settings-row-title">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="settings-slider-row">
      <div className="settings-slider-header">
        <div className="settings-row-title">{label}</div>
        <div className="settings-slider-value">{format(value)}</div>
      </div>
      <input
        type="range"
        className="settings-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`settings-toggle ${checked ? "on" : "off"}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

