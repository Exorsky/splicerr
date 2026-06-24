cmake_minimum_required(VERSION 3.22)

project(SplicerrBridge VERSION 0.1.0)

include(FetchContent)

FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.13
    GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(JUCE)

juce_add_plugin(SplicerrBridge
    COMPANY_NAME "Splicerr"
    BUNDLE_ID "de.kosro.splicerr.bridge"
    PLUGIN_MANUFACTURER_CODE Expr
    PLUGIN_CODE SpBr
    FORMATS AU VST3 Standalone
    PRODUCT_NAME "Splicerr Bridge"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
)

target_sources(SplicerrBridge
    PRIVATE
        Source/PluginEditor.cpp
        Source/PluginProcessor.cpp
)

target_compile_features(SplicerrBridge PRIVATE cxx_std_17)

target_compile_definitions(SplicerrBridge
    PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(SplicerrBridge
    PRIVATE
        juce::juce_audio_formats
        juce::juce_audio_utils
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)
