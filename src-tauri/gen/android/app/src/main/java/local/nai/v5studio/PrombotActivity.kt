package local.nai.v5studio

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class PrombotActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
