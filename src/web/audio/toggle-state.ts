/**
 * Sound on/off with the browser autoplay rule: a saved "on" only resumes on the user's first click, and any
 * explicit toggle before that click cancels the pending resume.
 */
export class SoundToggle {
  enabled = false;
  pending: boolean;

  constructor(savedOn: boolean) {
    this.pending = savedOn;
  }

  toggle(): boolean {
    this.pending = false;
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** Returns true when this click should turn sound on. */
  firstClick(): boolean {
    if (!this.pending) return false;
    this.pending = false;
    this.enabled = true;
    return true;
  }
}
