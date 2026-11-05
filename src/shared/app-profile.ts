interface AppProfile {
  name: string
  desktopName: string
  icon: string
  /** Chromium remote debugging port for automation; 0 leaves it closed. */
  debuggingPort: number
}

export function resolveAppProfile(packaged: boolean): AppProfile {
  if (packaged) {
    return { name: "Kolega", desktopName: "kolega", icon: "icon.png", debuggingPort: 0 }
  }

  return { name: "Kolega Dev", desktopName: "kolega-dev", icon: "icon-dev.png", debuggingPort: 9250 }
}
