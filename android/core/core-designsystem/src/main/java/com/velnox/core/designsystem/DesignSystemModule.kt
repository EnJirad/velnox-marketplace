package com.velnox.core.designsystem

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DesignSystemModule {

    // Design system is purely Compose-based, no runtime dependencies needed
    // This module exists for consistency with other core modules
    // and can be extended if needed (e.g., for theme injection)
}
