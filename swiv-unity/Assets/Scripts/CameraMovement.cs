// Smooth Follow from Standard Assets
// Converted to C# because I fucking hate UnityScript and it's inexistant C# interoperability
// If you have C# code and you want to edit SmoothFollow's vars ingame, use this instead.
using UnityEngine;

public class CameraMovement : MonoBehaviour {
    // The target we are following
    [SerializeField] Transform target = null;
    [SerializeField] float rotationDamping = 3.0f;


    // the height we want the camera to be above the target => is calculated on start
    float height = 0f;
    // The distance in the x-z plane to the target => calculated at start
    float distance = 0f;

    void Awake() {
        distance = Mathf.Sqrt(Mathf.Pow(transform.position.x - target.position.x, 2) + Mathf.Pow(transform.position.z - target.position.z, 2));
        height = transform.position.y - target.position.y;
    }

    void LateUpdate() {
        // Early out if we don't have a target
        if (!target) return;

        // Calculate the current rotation angles
        float wantedRotationAngle = target.eulerAngles.y;
        float wantedHeight = target.position.y + height;

        float currentRotationAngle = transform.eulerAngles.y;
        float currentHeight = transform.position.y;

        // Damp the rotation around the y-axis
        currentRotationAngle = Mathf.LerpAngle(currentRotationAngle, wantedRotationAngle, rotationDamping * Time.deltaTime);

        // Convert the angle into a rotation
        var currentRotation = Quaternion.Euler(0, currentRotationAngle, 0);

        // Set the position of the camera on the x-z plane to:
        // distance meters behind the target
        transform.position = target.position;
        transform.position -= currentRotation * Vector3.forward * distance;

        // Set the height of the camera
        transform.position = new Vector3(transform.position.x, target.position.y + height, transform.position.z);

        // Always look at the target
        transform.LookAt(target);
    }
}