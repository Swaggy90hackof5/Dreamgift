package com.dreamgift.app

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = SessionStore(applicationContext)

        setContent {
            DreamGiftTheme {
                var session by remember { mutableStateOf(store.load()) }
                var editing by remember { mutableStateOf<Wishlist?>(null) }

                val current = session
                val toEdit = editing

                when {
                    // First run: create a wishlist on the server.
                    current == null -> SetupScreen(
                        initial = null,
                        onSubmit = { p1, p2, upi ->
                            val created = Api.createWishlist(p1, p2, upi)
                            store.save(created)
                            session = created
                        },
                        onCancel = null
                    )

                    // Edit names / UPI ID.
                    toEdit != null -> SetupScreen(
                        initial = toEdit,
                        onSubmit = { p1, p2, upi ->
                            Api.updateDetails(current, p1, p2, upi)
                            editing = null
                        },
                        onCancel = { editing = null }
                    )

                    else -> HomeScreen(
                        session = current,
                        onEditDetails = { editing = it },
                        onSessionLost = {
                            store.clear()
                            session = null
                            Toast.makeText(
                                applicationContext,
                                "This wishlist no longer exists. Create a new one.",
                                Toast.LENGTH_LONG
                            ).show()
                        },
                        onDeleted = {
                            store.clear()
                            session = null
                        }
                    )
                }
            }
        }
    }
}
