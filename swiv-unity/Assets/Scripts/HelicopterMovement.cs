using UnityEngine;

public class HelicopterMovement : MonoBehaviour
{
    
    [SerializeField] float maxForwardSpeed = 40.0f;
    [SerializeField] float maxStrafeSpeed = 40.0f;
    [SerializeField] float maxRotationSpeed = 3.0f;
    [SerializeField] float hoverHeight = 50.0f;
    [SerializeField] float accendSpeed = 5f;
    [SerializeField] float descendSpeed = 1f;

    
    [Tooltip("Number of degrees to pitch forward/backward when moving forward/backward")][SerializeField] float pitchResponse = 35f;
    [Tooltip("Number of degrees to roll left/right when strafing left/right")][SerializeField] float rollResponse = 35f;

    private AudioSource bladesAudio = null;
    private float baseVolume = 0.7f;
    private float rotationY = 0;

    void Start()
    {
        bladesAudio = GetComponent<AudioSource>();
        baseVolume = bladesAudio.volume;
    }

    void Update()
    {
        float forwardSpeed = Input.GetAxis("MoveForwardBackward");
        float strafeSpeed = Input.GetAxis("MoveLeftRight");
        float rotationSpeed = Input.GetAxis("RotateLeftRight");

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

        rotationY += rotationSpeed * maxRotationSpeed * Time.deltaTime;
        transform.rotation = Quaternion.Euler(
            transform.rotation.x + forwardSpeed * pitchResponse + Random.Range(0f, 2f) * Time.deltaTime,
            rotationY, 
            transform.rotation.z - strafeSpeed * rollResponse + Random.Range(0f, 2f) * Time.deltaTime
        );

        transform.Rotate(Vector3.up, rotationSpeed * maxRotationSpeed * Time.deltaTime);

        // Modify the sound so it gets loader when you move
        float speedFactor = Mathf.Max(Mathf.Abs(forwardSpeed), Mathf.Abs(strafeSpeed));
        bladesAudio.volume = baseVolume + (1 - baseVolume) * speedFactor;

        // Increase the pitch when the heli has to accend, decrease during decent
        bladesAudio.pitch = 1f + 0.3f * heightDiff / hoverHeight + 0.3f * speedFactor;
    }
}
