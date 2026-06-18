#pragma once

#include <deque>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <limits>
#include <memory>
#include <mutex>
#include <thread>

class SplicerrBridgeAudioProcessor final : public juce::AudioProcessor,
                                           private juce::Timer
{
public:
    SplicerrBridgeAudioProcessor();
    ~SplicerrBridgeAudioProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlock(juce::AudioBuffer<double>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override;

    const juce::String getName() const override;
    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;
    double getTailLengthSeconds() const override;

    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override;
    void changeProgramName(int index, const juce::String& newName) override;

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    bool isHostPlaying() const noexcept { return hostPlaying.load(); }
    double getHostBpm() const noexcept { return hostBpm.load(); }
    bool hasSentToAppRecently() const noexcept;
    bool hasReceivedAudioRecently() const noexcept;
    bool hasLoadedSample() const noexcept { return sampleLoaded.load(); }
    bool hasLoadedSampleRecently() const noexcept;

private:
    template <typename FloatType>
    void processTransport(juce::AudioBuffer<FloatType>& buffer);

    void timerCallback() override;
    void sendSnapshot(bool force);
    void startAudioReceiver();
    void stopAudioReceiver();
    void pushAudioSamples(const float* samples, int frames);
    void handleSamplePacket(const char* data, int bytes);
    void handleControlPacket(const char* data, int bytes);
    void loadSampleFromPath(const juce::String& path,
                            const juce::String& uuid,
                            bool oneShot,
                            double durationMs);

    template <typename FloatType>
    void mixStreamedAudio(juce::AudioBuffer<FloatType>& buffer);

    template <typename FloatType>
    void renderLoadedSample(juce::AudioBuffer<FloatType>& buffer);

    struct LoadedSample
    {
        juce::AudioBuffer<float> buffer;
        double sampleRate = 44100.0;
        bool oneShot = false;
        juce::String uuid;
        double durationMs = 0.0;
    };

    static constexpr int udpPort = 37651;
    static constexpr int timerHz = 60;
    static constexpr int keepAliveMs = 250;
    static constexpr int streamedAudioChannels = 2;
    static constexpr int maxQueuedAudioFrames = 48000 * 2;

    juce::DatagramSocket socket;
    juce::DatagramSocket audioSocket;
    juce::AudioFormatManager formatManager;
    std::thread audioReceiverThread;
    std::atomic<bool> audioReceiverRunning { false };
    std::mutex audioMutex;
    std::deque<float> audioQueue;
    std::mutex sampleMutex;
    std::shared_ptr<const LoadedSample> loadedSample;

    std::atomic<bool> hostPlaying { false };
    std::atomic<bool> sampleLoaded { false };
    std::atomic<int> audioUdpPort { 0 };
    std::atomic<bool> hostLooping { false };
    std::atomic<double> hostBpm { 0.0 };
    std::atomic<double> hostPpqPosition { 0.0 };
    std::atomic<double> hostTimeInSeconds { 0.0 };
    std::atomic<double> hostLoopStartPpq { 0.0 };
    std::atomic<double> hostLoopEndPpq { 0.0 };
    std::atomic<double> loadedSampleDurationSeconds { 0.0 };
    std::atomic<double> samplePositionSeconds { 0.0 };
    std::atomic<bool> sampleActive { false };
    std::atomic<int> hostTimeSignatureNumerator { 4 };
    std::atomic<int> hostTimeSignatureDenominator { 4 };
    std::atomic<double> currentSampleRate { 0.0 };
    std::atomic<int64_t> lastPacketMs { 0 };
    std::atomic<int64_t> lastAudioPacketMs { 0 };
    std::atomic<int64_t> lastSampleLoadMs { 0 };
    std::atomic<int64_t> sampleRevision { 0 };

    bool lastSentPlaying = false;
    double lastSentBpm = -1.0;
    double lastSentPpqPosition = -1.0;
    double lastSentSamplePositionSeconds = -1.0;
    bool lastSentSampleActive = false;
    int lastSentTimeSignatureNumerator = 4;
    int lastSentTimeSignatureDenominator = 4;
    int64_t renderedSampleRevision = -1;
    int64_t lastOneShotTriggerBar = std::numeric_limits<int64_t>::min();
    bool oneShotActive = false;
    double oneShotReadPosition = 0.0;
    double loopReadPosition = 0.0;
    double lastRenderedPpq = std::numeric_limits<double>::quiet_NaN();
    double lastRenderedHostTime = std::numeric_limits<double>::quiet_NaN();
    double lastOneShotTriggerPpq = -std::numeric_limits<double>::infinity();
    std::atomic<bool> appPlaybackEnabled { true };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(SplicerrBridgeAudioProcessor)
};
