package local.nai.v5studio

import android.content.Context
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private external fun initNdkContext(context: Context)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    initNdkContext(this.applicationContext)

    // Edge-to-edge (targetSdk 35+) disables adjustResize, so the WebView would stay
    // full height under the soft keyboard. Shrink the content by the IME height instead
    // (the page shrinks exactly once, above the keyboard; NAI-011), and hand the WebView
    // insets reduced by that height: no IME inset (not applied twice) and no navigation
    // bar inset at the bottom while the keyboard covers it.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      if (view.paddingBottom != ime.bottom) view.setPadding(0, 0, 0, ime.bottom)
      insets.inset(0, 0, 0, ime.bottom)
    }
  }
}
