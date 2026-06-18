#include "PluginEditor.h"

namespace
{
void configureLabel(juce::Label& label, float fontSize, juce::Justification justification)
{
    label.setFont(juce::FontOptions(fontSize));
    label.setJustificationType(justification);
    label.setColour(juce::Label::textColourId, juce::Colours::white);
}
} // namespace

SplicerrBridgeAudioProcessorEditor::SplicerrBridgeAudioProcessorEditor(
    SplicerrBridgeAudioProcessor& ownerProcessor)
    : AudioProcessorEditor(&ownerProcessor),
      audioProcessor(ownerProcessor)
{
    configureLabel(titleLabel, 22.0f, juce::Justification::centredLeft);
    titleLabel.setText("Splicerr Bridge", juce::dontSendNotification);
    addAndMakeVisible(titleLabel);

    configureLabel(statusLabel, 15.0f, juce::Justification::centredLeft);
    addAndMakeVisible(statusLabel);

    configureLabel(tempoLabel, 15.0f, juce::Justification::centredLeft);
    addAndMakeVisible(tempoLabel);

    configureLabel(audioLabel, 15.0f, juce::Justification::centredLeft);
    addAndMakeVisible(audioLabel);

    configureLabel(hintLabel, 13.0f, juce::Justification::centredLeft);
    hintLabel.setColour(juce::Label::textColourId, juce::Colours::lightgrey);
    hintLabel.setText("Pick a sample in Splicerr. The bridge loads it and plays it on the DAW grid.",
                      juce::dontSendNotification);
    addAndMakeVisible(hintLabel);

    setSize(420, 205);
    updateLabels();
    startTimerHz(8);
}

SplicerrBridgeAudioProcessorEditor::~SplicerrBridgeAudioProcessorEditor()
{
    stopTimer();
}

void SplicerrBridgeAudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff15171c));

    auto bounds = getLocalBounds().toFloat().reduced(16.0f);
    g.setColour(juce::Colour(0xff2d333b));
    g.drawRoundedRectangle(bounds, 8.0f, 1.0f);

    g.setColour(audioProcessor.hasSentToAppRecently()
                    ? juce::Colour(0xff43d17a)
                    : juce::Colour(0xfff0b354));
    g.fillEllipse(24.0f, 69.0f, 10.0f, 10.0f);

    g.setColour(audioProcessor.hasLoadedSample()
                    ? juce::Colour(0xff43d17a)
                    : juce::Colour(0xfff0b354));
    g.fillEllipse(24.0f, 125.0f, 10.0f, 10.0f);
}

void SplicerrBridgeAudioProcessorEditor::resized()
{
    auto bounds = getLocalBounds().reduced(24, 18);
    titleLabel.setBounds(bounds.removeFromTop(34));
    bounds.removeFromTop(10);
    statusLabel.setBounds(bounds.removeFromTop(28).withTrimmedLeft(18));
    tempoLabel.setBounds(bounds.removeFromTop(28));
    audioLabel.setBounds(bounds.removeFromTop(28).withTrimmedLeft(18));
    bounds.removeFromTop(8);
    hintLabel.setBounds(bounds);
}

void SplicerrBridgeAudioProcessorEditor::timerCallback()
{
    updateLabels();
    repaint();
}

void SplicerrBridgeAudioProcessorEditor::updateLabels()
{
    statusLabel.setText(audioProcessor.isHostPlaying()
                            ? "Host transport: playing"
                            : "Host transport: stopped",
                        juce::dontSendNotification);

    const auto bpm = audioProcessor.getHostBpm();
    tempoLabel.setText(bpm > 0.0
                           ? "Host BPM: " + juce::String(bpm, 2)
                           : "Host BPM: waiting for DAW",
                       juce::dontSendNotification);

    audioLabel.setText(audioProcessor.hasLoadedSample()
                           ? "Sample: loaded in bridge"
                           : "Sample: waiting for Splicerr",
                       juce::dontSendNotification);
}
