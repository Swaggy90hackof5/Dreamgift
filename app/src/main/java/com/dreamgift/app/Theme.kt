package com.dreamgift.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DreamColors = lightColorScheme(
    primary = Color(0xFF9C2A4A),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFD9E1),
    onPrimaryContainer = Color(0xFF3F0017),
    secondary = Color(0xFFB8802A),
    background = Color(0xFFFFF8F2),
    onBackground = Color(0xFF241A1C),
    surface = Color(0xFFFFF8F2),
    onSurface = Color(0xFF241A1C),
    surfaceVariant = Color(0xFFF6E4E0),
    onSurfaceVariant = Color(0xFF52434A)
)

@Composable
fun DreamGiftTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DreamColors, content = content)
}
