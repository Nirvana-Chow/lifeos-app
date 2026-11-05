# Native UI release-check readiness

Actual required run42067441908, job127385591705 failed its early native Chrome step after the build/isolated Auth and PostgreSQL job had passed. Two distinct observations are retained: the 1920px requirement metadata resize began from a temporarily expanded rendered column; and the touch-density geometry callback dereferenced a virtual table row before it mounted. The former is handled in the native-grid layout fix, not by relaxing resize assertions.

For the density check, the theme-toggle selector exists in the actual shared ThemeSwitch. The original test passes locally; the Linux stack position maps to the virtual-row measurement. The check now first waits for the actual first virtual row and theme control to be visible, then retains every existing font, control-size, row-height, contrast and virtualization assertion. No fixed sleep or production behavior is added.

Executed native Chrome on the real shell at desktop/mobile/touch viewports before and after the narrow readiness change: both passed locally. This addresses the missing mount precondition; actual Linux CI still must pass. No server configuration, runtime, dependency, business-data or permission change is included.
