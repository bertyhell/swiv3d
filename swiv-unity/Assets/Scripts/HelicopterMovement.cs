using UnityEngine;
using UnityEngine.InputSystem;

public class HelicopterMovement : MonoBehaviour {
    [SerializeField] float maxForwardSpeed = 41.0f;
    [SerializeField] float maxStrafeSpeed = 41.0f;
    [SerializeField] float maxRotationSpeed = 120.0f;
    [SerializeField] float hoverHeight = 50.0f;
    [SerializeField] float accendSpeed = 5f;
    [SerializeField] float descendSpeed = 1f;

    //private InputAction move;
    //private InputAction rotate;
    private PlayerControls playerControls;


    [Tooltip("Number of degrees to pitch forward/backward when moving forward/backward")] [SerializeField] float pitchResponse = 35f;
    [Tooltip("Number of degrees to roll left/right when strafing left/right")] [SerializeField] float rollResponse = 35f;

    private AudioSource bladesAudio = null;
    private float baseVolume = 0.7f;

    private float forwardSpeed = 0f;
    private float strafeSpeed = 0f;
    private float rotationSpeed = 0f;

    private float pitch = 0;
    private float yaw = 0;
    private float spin = 0;


    void Awake() {
        playerControls = new PlayerControls();

        playerControls.Player.Move.performed += ctx => OnMove(ctx.ReadValue<Vector2>());
        playerControls.Player.Move.canceled += ctx => OnMove(new Vector2(0, 0));
        playerControls.Player.Rotate.performed += ctx => OnRotate(ctx.ReadValue<Vector2>());
        playerControls.Player.Rotate.canceled += ctx => OnRotate(new Vector2(0, 0));
        bladesAudio = GetComponent<AudioSource>();
        baseVolume = bladesAudio.volume;
    }

    private void OnEnable() {
        if (playerControls != null) {
            playerControls.Enable();
        }
    }

    private void OnDisable() {
        playerControls.Disable();
    }

    void OnMove(Vector2 direction) {
        Debug.Log("triggered move " + direction.ToString());
        forwardSpeed = direction[1];
        strafeSpeed = direction[0];
    }

    void OnRotate(Vector2 direction) {
        Debug.Log("triggered rotate " + direction.ToString());
        rotationSpeed = direction[0];
    }

    void Update() {
        float currentHoverHeight = hoverHeight;

        RaycastHit hit;
        Ray downRay = new Ray(transform.position, -Vector3.up);
        if (Physics.Raycast(downRay, out hit)) {
            currentHoverHeight = hit.distance;
        }

        float heightDiff = hoverHeight - currentHoverHeight;
        float heightCorrection;
        if (heightDiff < 0) {
            heightCorrection = heightDiff * descendSpeed;
        } else {
            heightCorrection = heightDiff * accendSpeed;
        }

        float deltaX = strafeSpeed * maxStrafeSpeed * Time.deltaTime + Random.Range(0f, 2f) * Time.deltaTime;
        float deltaZ = forwardSpeed * maxForwardSpeed * Time.deltaTime + Random.Range(0f, 2f) * Time.deltaTime;

        Vector3 moveVector = transform.right * deltaX + transform.forward * deltaZ;

        transform.position = new Vector3(
            transform.position.x + moveVector.x,
            transform.position.y + heightCorrection * Time.deltaTime,
            transform.position.z + moveVector.z
        );

        // Dip nose down when moving forward
        pitch = transform.rotation.x + forwardSpeed * pitchResponse + Random.Range(0f, 2f) * Time.deltaTime;

        // Rotate body left/right durinbg strafing and during rotation with mouse
        spin = transform.rotation.z - strafeSpeed * rollResponse + Random.Range(0f, 2f) * Time.deltaTime;

        transform.rotation = Quaternion.Euler(
            pitch,
            yaw,
            spin
        );

        // Modify the sound so it gets loader when you move
        float speedFactor = Mathf.Max(Mathf.Abs(forwardSpeed), Mathf.Abs(strafeSpeed));
        bladesAudio.volume = baseVolume + (1 - baseVolume) * speedFactor;

        // Increase the pitch when the heli has to accend, decrease during decent
        bladesAudio.pitch = 1f + 0.3f * heightDiff / hoverHeight + 0.3f * speedFactor;

        // Rotate nose left/right when mouse moves
        yaw += rotationSpeed * maxRotationSpeed * Time.deltaTime;

        transform.Rotate(Vector3.up, rotationSpeed * maxRotationSpeed * Time.deltaTime);
    }
}
